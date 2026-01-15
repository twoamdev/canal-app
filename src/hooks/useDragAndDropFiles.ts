/**
 * useDragAndDropFiles Hook
 *
 * Handles file drag and drop to create assets and source nodes.
 * Uses the new Asset/Layer/Node architecture.
 *
 * Supports:
 * - Single video/image files
 * - Folders containing image sequences (e.g., frame_001.png, frame_002.png, ...)
 *
 * Spawns nodes IMMEDIATELY with placeholder assets, then processes
 * files in the background and updates assets when ready.
 */

import { useCallback, useState } from 'react';
import { useReactFlow, type XYPosition } from '@xyflow/react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';
import { useTimelineStore } from '../stores/timelineStore';
import {
  createAssetFromFile,
  createPlaceholderAsset,
  createPlaceholderSequenceAsset,
  createPlaceholderShapeAsset,
  createImageSequenceAsset,
  createShapeAssetFromSVGFile,
  isVideoFile,
  isImageFile,
  isSVGFile,
} from '../utils/asset-factory';
import { createSourceNode, type SourceNode } from '../types/scene-graph';
import { getAssetFrameCount } from '../types/assets';
import { detectImageSequences, type DetectedSequence } from '../utils/image-sequence';

export interface DragAndDropState {
  isProcessing: boolean;
  progress: { current: number; total: number } | null;
  error: string | null;
}

export function useDragAndDropFiles() {
  const { screenToFlowPosition } = useReactFlow();
  const addAsset = useAssetStore((state) => state.addAsset);
  const updateAsset = useAssetStore((state) => state.updateAsset);
  const addNode = useGraphStore((state) => state.addNode);
  const updateNode = useGraphStore((state) => state.updateNode);
  const setFrameRange = useTimelineStore((state) => state.setFrameRange);
  const frameEnd = useTimelineStore((state) => state.frameEnd);

  const [state, setState] = useState<DragAndDropState>({
    isProcessing: false,
    progress: null,
    error: null,
  });

  /**
   * Recursively read all files from a directory entry
   */
  const readDirectoryFiles = async (dirEntry: FileSystemDirectoryEntry): Promise<File[]> => {
    const files: File[] = [];
    const reader = dirEntry.createReader();

    const readEntries = (): Promise<FileSystemEntry[]> => {
      return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
    };

    const getFile = (fileEntry: FileSystemFileEntry): Promise<File> => {
      return new Promise((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
    };

    // Read all entries (may need multiple calls for large directories)
    let entries: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];
    do {
      batch = await readEntries();
      entries = entries.concat(batch);
    } while (batch.length > 0);

    for (const entry of entries) {
      if (entry.isFile) {
        try {
          const file = await getFile(entry as FileSystemFileEntry);
          files.push(file);
        } catch (e) {
          console.warn(`Failed to read file ${entry.name}:`, e);
        }
      }
      // Note: We don't recurse into subdirectories for image sequences
    }

    return files;
  };

  const handleFileDrop = useCallback(
    async (event: React.DragEvent, position: XYPosition) => {
      event.preventDefault();

      const flowPosition = screenToFlowPosition(position);

      // Track all items to process
      const processingFiles: Array<{ file: File; assetId: string; nodeId: string }> = [];
      const processingSequences: Array<{ sequence: DetectedSequence; assetId: string; nodeId: string }> = [];
      const processingSVGs: Array<{ file: File; assetId: string; nodeId: string }> = [];

      // Check for folder drops using dataTransfer.items
      const items = event.dataTransfer.items;
      let nodeIndex = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = item.webkitGetAsEntry?.();

        if (entry?.isDirectory) {
          // It's a folder - scan for image sequences
          console.log(`[DragAndDrop] Scanning folder: ${entry.name}`);

          const dirFiles = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
          const sequences = detectImageSequences(dirFiles);

          if (sequences.length > 0) {
            // Use the best sequence (most frames)
            const sequence = sequences[0];
            console.log(`[DragAndDrop] Found image sequence: ${sequence.baseName} (${sequence.frameCount} frames)`);

            // Create placeholder for sequence
            const placeholderAsset = createPlaceholderSequenceAsset(sequence);
            addAsset(placeholderAsset);

            // Calculate position for this node
            const offsetPosition = {
              x: flowPosition.x + nodeIndex * 250,
              y: flowPosition.y + nodeIndex * 50,
            };

            // Create source node
            const sourceNode = createSourceNode(
              placeholderAsset.id,
              placeholderAsset.name,
              sequence.frameCount,
              offsetPosition
            );
            addNode(sourceNode);

            processingSequences.push({
              sequence,
              assetId: placeholderAsset.id,
              nodeId: sourceNode.id,
            });

            nodeIndex++;
            console.log(`[DragAndDrop] Created placeholder node for sequence: ${placeholderAsset.name}`);
          } else {
            console.warn(`[DragAndDrop] No image sequence found in folder: ${entry.name}`);
          }
        } else if (entry?.isFile) {
          // It's a single file
          const file = item.getAsFile();
          if (file) {
            const offsetPosition = {
              x: flowPosition.x + nodeIndex * 250,
              y: flowPosition.y + nodeIndex * 50,
            };

            if (isSVGFile(file)) {
              // SVG file - create shape asset
              const placeholderAsset = createPlaceholderShapeAsset(file.name.replace(/\.svg$/i, ''));
              addAsset(placeholderAsset);

              const sourceNode = createSourceNode(
                placeholderAsset.id,
                placeholderAsset.name,
                1, // Shapes are single frame
                offsetPosition
              );
              addNode(sourceNode);

              processingSVGs.push({
                file,
                assetId: placeholderAsset.id,
                nodeId: sourceNode.id,
              });

              nodeIndex++;
              console.log(`[DragAndDrop] Created placeholder node for SVG: ${file.name}`);
            } else if (isVideoFile(file) || isImageFile(file)) {
              const placeholderAsset = createPlaceholderAsset(file);
              addAsset(placeholderAsset);

              const defaultFrameCount = isVideoFile(file) ? 300 : 1;
              const sourceNode = createSourceNode(
                placeholderAsset.id,
                placeholderAsset.name,
                defaultFrameCount,
                offsetPosition
              );
              addNode(sourceNode);

              processingFiles.push({
                file,
                assetId: placeholderAsset.id,
                nodeId: sourceNode.id,
              });

              nodeIndex++;
              console.log(`[DragAndDrop] Created placeholder node for: ${file.name}`);
            }
          }
        }
      }

      // Fallback: If no items were found via webkitGetAsEntry, use files array
      if (processingFiles.length === 0 && processingSequences.length === 0 && processingSVGs.length === 0) {
        const files = Array.from(event.dataTransfer.files);

        for (const file of files) {
          const offsetPosition = {
            x: flowPosition.x + nodeIndex * 250,
            y: flowPosition.y + nodeIndex * 50,
          };

          if (isSVGFile(file)) {
            const placeholderAsset = createPlaceholderShapeAsset(file.name.replace(/\.svg$/i, ''));
            addAsset(placeholderAsset);

            const sourceNode = createSourceNode(
              placeholderAsset.id,
              placeholderAsset.name,
              1,
              offsetPosition
            );
            addNode(sourceNode);

            processingSVGs.push({
              file,
              assetId: placeholderAsset.id,
              nodeId: sourceNode.id,
            });

            nodeIndex++;
          } else if (isVideoFile(file) || isImageFile(file)) {
            const placeholderAsset = createPlaceholderAsset(file);
            addAsset(placeholderAsset);

            const defaultFrameCount = isVideoFile(file) ? 300 : 1;
            const sourceNode = createSourceNode(
              placeholderAsset.id,
              placeholderAsset.name,
              defaultFrameCount,
              offsetPosition
            );
            addNode(sourceNode);

            processingFiles.push({
              file,
              assetId: placeholderAsset.id,
              nodeId: sourceNode.id,
            });

            nodeIndex++;
          }
        }
      }

      const totalItems = processingFiles.length + processingSequences.length + processingSVGs.length;

      if (totalItems === 0) {
        console.warn('No supported files, image sequences, or SVGs dropped');
        return;
      }

      // STEP 2: Process all items in the background
      setState({
        isProcessing: true,
        progress: { current: 0, total: totalItems },
        error: null,
      });

      let completed = 0;
      let maxFrameCount = frameEnd;

      // Process regular files
      for (const { file, assetId, nodeId } of processingFiles) {
        try {
          updateAsset(assetId, {
            loadingState: { isLoading: true, progress: 0 },
          });

          const processedAsset = await createAssetFromFile(file, {
            onProgress: (current, total) => {
              const progress = total > 0 ? current / total : 0;
              updateAsset(assetId, {
                loadingState: { isLoading: true, progress },
              });
            },
          });

          updateAsset(assetId, {
            intrinsicWidth: processedAsset.intrinsicWidth,
            intrinsicHeight: processedAsset.intrinsicHeight,
            metadata: processedAsset.metadata,
            loadingState: undefined,
          });

          const actualFrameCount = getAssetFrameCount(processedAsset);

          updateNode(nodeId, (node) => {
            if (node.type !== 'source') return node;
            return {
              ...node,
              layer: {
                ...node.layer,
                timeRange: {
                  inFrame: 0,
                  outFrame: actualFrameCount,
                  sourceOffset: 0,
                },
              },
            } as SourceNode;
          });

          if (actualFrameCount > maxFrameCount) {
            maxFrameCount = actualFrameCount;
          }

          completed++;
          setState((prev) => ({
            ...prev,
            progress: { current: completed, total: totalItems },
          }));

          console.log(`[DragAndDrop] Finished processing: ${file.name} (${actualFrameCount} frames)`);
        } catch (error) {
          console.error(`Failed to process file ${file.name}:`, error);

          updateAsset(assetId, {
            loadingState: {
              isLoading: false,
              error: error instanceof Error ? error.message : 'Processing failed',
            },
          });

          setState((prev) => ({
            ...prev,
            error: `Failed to process ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }));
        }
      }

      // Process image sequences
      for (const { sequence, assetId, nodeId } of processingSequences) {
        try {
          updateAsset(assetId, {
            loadingState: { isLoading: true, progress: 0 },
          });

          const processedAsset = await createImageSequenceAsset(sequence, {
            fps: 24, // Default to 24fps for image sequences
            onProgress: (current, total) => {
              const progress = total > 0 ? current / total : 0;
              updateAsset(assetId, {
                loadingState: { isLoading: true, progress },
              });
            },
          });

          updateAsset(assetId, {
            intrinsicWidth: processedAsset.intrinsicWidth,
            intrinsicHeight: processedAsset.intrinsicHeight,
            metadata: processedAsset.metadata,
            loadingState: undefined,
          });

          const actualFrameCount = getAssetFrameCount(processedAsset);

          updateNode(nodeId, (node) => {
            if (node.type !== 'source') return node;
            return {
              ...node,
              layer: {
                ...node.layer,
                timeRange: {
                  inFrame: 0,
                  outFrame: actualFrameCount,
                  sourceOffset: 0,
                },
              },
            } as SourceNode;
          });

          if (actualFrameCount > maxFrameCount) {
            maxFrameCount = actualFrameCount;
          }

          completed++;
          setState((prev) => ({
            ...prev,
            progress: { current: completed, total: totalItems },
          }));

          console.log(`[DragAndDrop] Finished processing sequence: ${processedAsset.name} (${actualFrameCount} frames)`);
        } catch (error) {
          console.error(`Failed to process sequence:`, error);

          updateAsset(assetId, {
            loadingState: {
              isLoading: false,
              error: error instanceof Error ? error.message : 'Processing failed',
            },
          });

          setState((prev) => ({
            ...prev,
            error: `Failed to process sequence: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }));
        }
      }

      // Process SVG files
      for (const { file, assetId, nodeId } of processingSVGs) {
        try {
          updateAsset(assetId, {
            loadingState: { isLoading: true, progress: 0.5 },
          });

          const processedAsset = await createShapeAssetFromSVGFile(file);

          updateAsset(assetId, {
            intrinsicWidth: processedAsset.intrinsicWidth,
            intrinsicHeight: processedAsset.intrinsicHeight,
            metadata: processedAsset.metadata,
            loadingState: undefined,
          });

          // Shapes are single frame but can be extended
          updateNode(nodeId, (node) => {
            if (node.type !== 'source') return node;
            return {
              ...node,
              layer: {
                ...node.layer,
                timeRange: {
                  inFrame: 0,
                  outFrame: 1,
                  sourceOffset: 0,
                },
              },
            } as SourceNode;
          });

          completed++;
          setState((prev) => ({
            ...prev,
            progress: { current: completed, total: totalItems },
          }));

          console.log(`[DragAndDrop] Finished processing SVG: ${file.name} (${processedAsset.intrinsicWidth}x${processedAsset.intrinsicHeight})`);
        } catch (error) {
          console.error(`Failed to process SVG ${file.name}:`, error);

          updateAsset(assetId, {
            loadingState: {
              isLoading: false,
              error: error instanceof Error ? error.message : 'Processing failed',
            },
          });

          setState((prev) => ({
            ...prev,
            error: `Failed to process SVG ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }));
        }
      }

      // Update timeline range if we have longer content
      if (maxFrameCount > frameEnd) {
        setFrameRange(0, maxFrameCount);
        console.log(`[DragAndDrop] Updated timeline range to 0-${maxFrameCount}`);
      }

      setState({
        isProcessing: false,
        progress: null,
        error: null,
      });
    },
    [screenToFlowPosition, addAsset, updateAsset, addNode, updateNode, setFrameRange, frameEnd]
  );

  const handleFileDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  return {
    handleFileDrop,
    handleFileDragOver,
    state,
  };
}
