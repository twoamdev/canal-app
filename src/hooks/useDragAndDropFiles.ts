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
import { useLayerStore } from '../stores/layerStore';
import { useGroupStore } from '../stores/groupStore';
import { useTimelineStore } from '../stores/timelineStore';
import {
  createAssetFromFile,
  createPlaceholderAsset,
  createPlaceholderSequenceAsset,
  createImageSequenceAsset,
  createSplitShapeAssetsFromSVGFile,
  isVideoFile,
  isImageFile,
  isSVGFile,
} from '../utils/asset-factory';
import {
  createSourceNode,
  createLayer,
  createGroup,
  createGroupNode,
} from '../types/scene-graph';
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
  const addEdge = useGraphStore((state) => state.addEdge);
  const addLayer = useLayerStore((state) => state.addLayer);
  const updateLayer = useLayerStore((state) => state.updateLayer);
  const addGroup = useGroupStore((state) => state.addGroup);
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

      // Track items that need deferred processing (video/image)
      const processingFiles: Array<{ file: File; assetId: string; nodeId: string; layerId: string }> = [];
      const processingSequences: Array<{ sequence: DetectedSequence; assetId: string; nodeId: string; layerId: string }> = [];
      // Track SVGs that were processed immediately (for counting)
      let svgItemsProcessed = 0;

      // Helper function to process SVG files immediately with path splitting
      const processSVGFile = async (file: File, basePosition: { x: number; y: number }) => {
        try {
          const splitResult = await createSplitShapeAssetsFromSVGFile(file);
          const { assets } = splitResult;
          const svgName = file.name.replace(/\.svg$/i, '');

          if (assets.length === 0) {
            console.warn(`[DragAndDrop] No paths found in SVG: ${file.name}`);
            return 0;
          }

          // Single path - simple case, just create one node
          if (assets.length === 1) {
            const shapeAsset = assets[0];
            addAsset(shapeAsset);

            const layer = createLayer(shapeAsset.id, shapeAsset.name, 1);
            addLayer(layer);

            const sourceNode = createSourceNode(layer.id, basePosition);
            addNode(sourceNode);

            console.log(`[DragAndDrop] Created single shape node: ${shapeAsset.name}`);
            return 1;
          }

          // Multiple paths - create individual nodes and wire to GroupNode
          console.log(`[DragAndDrop] Splitting SVG "${svgName}" into ${assets.length} paths`);

          const sourceNodeIds: string[] = [];

          // Layout constants
          const nodeWidth = 220;
          const nodeSpacing = 30;
          const startX = basePosition.x - (assets.length * (nodeWidth + nodeSpacing)) / 2;

          // Create assets, layers, and source nodes for each path
          // Process in SVG order (first = bottom of stack)
          assets.forEach((shapeAsset, index) => {
            addAsset(shapeAsset);

            const layer = createLayer(shapeAsset.id, shapeAsset.name, 1);
            addLayer(layer);

            // Set layer position from the original SVG position
            const originalPos = shapeAsset.metadata.originalPosition;
            if (originalPos) {
              updateLayer(layer.id, {
                baseTransform: {
                  ...layer.baseTransform,
                  position: { x: originalPos.x, y: originalPos.y },
                },
              });
            }

            // Position source nodes horizontally
            const nodeX = startX + index * (nodeWidth + nodeSpacing);
            const sourceNode = createSourceNode(layer.id, {
              x: nodeX,
              y: basePosition.y - 150,
            });
            addNode(sourceNode);
            sourceNodeIds.push(sourceNode.id);

            console.log(`[DragAndDrop] Created path ${index + 1}: ${shapeAsset.name}`);
          });

          // Create a Group to hold all layers (in order: first = bottom)
          // Create Group with empty members - connections will populate memberIds
          const group = createGroup(svgName, [], 1);
          addGroup(group);

          // Create GroupNode positioned below the source nodes
          const groupNode = createGroupNode(group.id, svgName, {
            x: basePosition.x - nodeWidth / 2,
            y: basePosition.y + 100,
          });
          addNode(groupNode);

          // Connect all source nodes to the group node in order (index 0 = input-0 = bottom layer)
          sourceNodeIds.forEach((sourceId, index) => {
            addEdge({
              id: `edge_svg_${Date.now()}_${index}`,
              source: sourceId,
              target: groupNode.id,
              targetHandle: `input-${index}`,
            });
          });

          console.log(`[DragAndDrop] Created GroupNode "${svgName}" with ${assets.length} layers`);
          return 1; // Count as 1 item for progress purposes
        } catch (error) {
          console.error(`[DragAndDrop] Failed to process SVG ${file.name}:`, error);
          return 0;
        }
      };

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

            // Create layer for the asset
            const layer = createLayer(placeholderAsset.id, placeholderAsset.name, sequence.frameCount);
            addLayer(layer);

            // Calculate position for this node
            const offsetPosition = {
              x: flowPosition.x + nodeIndex * 250,
              y: flowPosition.y + nodeIndex * 50,
            };

            // Create source node referencing the layer
            const sourceNode = createSourceNode(layer.id, offsetPosition);
            addNode(sourceNode);

            processingSequences.push({
              sequence,
              assetId: placeholderAsset.id,
              nodeId: sourceNode.id,
              layerId: layer.id,
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
              // SVG file - process immediately with path splitting
              const processed = await processSVGFile(file, offsetPosition);
              if (processed > 0) {
                svgItemsProcessed += processed;
                nodeIndex++;
              }
            } else if (isVideoFile(file) || isImageFile(file)) {
              const placeholderAsset = createPlaceholderAsset(file);
              addAsset(placeholderAsset);

              const defaultFrameCount = isVideoFile(file) ? 300 : 1;
              const layer = createLayer(placeholderAsset.id, placeholderAsset.name, defaultFrameCount);
              addLayer(layer);

              const sourceNode = createSourceNode(layer.id, offsetPosition);
              addNode(sourceNode);

              processingFiles.push({
                file,
                assetId: placeholderAsset.id,
                nodeId: sourceNode.id,
                layerId: layer.id,
              });

              nodeIndex++;
              console.log(`[DragAndDrop] Created placeholder node for: ${file.name}`);
            }
          }
        }
      }

      // Fallback: If no items were found via webkitGetAsEntry, use files array
      if (processingFiles.length === 0 && processingSequences.length === 0 && svgItemsProcessed === 0) {
        const files = Array.from(event.dataTransfer.files);

        for (const file of files) {
          const offsetPosition = {
            x: flowPosition.x + nodeIndex * 250,
            y: flowPosition.y + nodeIndex * 50,
          };

          if (isSVGFile(file)) {
            // SVG file - process immediately with path splitting
            const processed = await processSVGFile(file, offsetPosition);
            if (processed > 0) {
              svgItemsProcessed += processed;
              nodeIndex++;
            }
          } else if (isVideoFile(file) || isImageFile(file)) {
            const placeholderAsset = createPlaceholderAsset(file);
            addAsset(placeholderAsset);

            const defaultFrameCount = isVideoFile(file) ? 300 : 1;
            const layer = createLayer(placeholderAsset.id, placeholderAsset.name, defaultFrameCount);
            addLayer(layer);

            const sourceNode = createSourceNode(layer.id, offsetPosition);
            addNode(sourceNode);

            processingFiles.push({
              file,
              assetId: placeholderAsset.id,
              nodeId: sourceNode.id,
              layerId: layer.id,
            });

            nodeIndex++;
          }
        }
      }

      // Total items that need deferred processing (SVGs are already done)
      const totalItems = processingFiles.length + processingSequences.length;

      // If we only had SVGs (which are processed immediately), we're done
      if (totalItems === 0 && svgItemsProcessed === 0) {
        console.warn('No supported files, image sequences, or SVGs dropped');
        return;
      }

      // If only SVGs were dropped (already processed), just finish
      if (totalItems === 0) {
        console.log(`[DragAndDrop] Finished processing ${svgItemsProcessed} SVG file(s)`);
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
      for (const { file, assetId, layerId } of processingFiles) {
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

          // Update layer's timeRange in LayerStore
          updateLayer(layerId, {
            timeRange: {
              inFrame: 0,
              outFrame: actualFrameCount,
              sourceOffset: 0,
            },
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
      for (const { sequence, assetId, layerId } of processingSequences) {
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

          // Update layer's timeRange in LayerStore
          updateLayer(layerId, {
            timeRange: {
              inFrame: 0,
              outFrame: actualFrameCount,
              sourceOffset: 0,
            },
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
    [screenToFlowPosition, addAsset, updateAsset, addNode, addEdge, addLayer, updateLayer, addGroup, setFrameRange, frameEnd]
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
