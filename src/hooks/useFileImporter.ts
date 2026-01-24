import { useState, useCallback } from 'react';
import { type XYPosition } from '@xyflow/react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';
import { useLayerStore } from '../stores/layerStore';
import { useTimelineStore } from '../stores/timelineStore';
import {
  createAssetFromFile,
  createPlaceholderAsset,
  createPlaceholderSequenceAsset,
  createImageSequenceAsset,
  createShapeAssetFromSVGFile,
  isVideoFile,
  isImageFile,
  isSVGFile,
} from '../utils/asset-factory';
import { createSourceNode, createLayer } from '../types/scene-graph';
import { getAssetFrameCount } from '../types/assets';
import { detectImageSequences, type DetectedSequence } from '../utils/image-sequence';

export interface ImportState {
  isProcessing: boolean;
  progress: { current: number; total: number } | null;
  error: string | null;
}

interface ImportOptions {
  files: File[];
  /** Optional: specific for Drag and Drop folder entries */
  entries?: FileSystemEntry[]; 
  basePosition: XYPosition;
}

export function useFileImporter() {
  const addAsset = useAssetStore((state) => state.addAsset);
  const updateAsset = useAssetStore((state) => state.updateAsset);
  const addNode = useGraphStore((state) => state.addNode);
  const addLayer = useLayerStore((state) => state.addLayer);
  const updateLayer = useLayerStore((state) => state.updateLayer);
  const setFrameRange = useTimelineStore((state) => state.setFrameRange);
  const frameEnd = useTimelineStore((state) => state.frameEnd);

  const [state, setState] = useState<ImportState>({
    isProcessing: false,
    progress: null,
    error: null,
  });

  /**
   * Helper: Recursively read all files from a directory entry
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
    }
    return files;
  };

  /**
   * Helper: Process SVG files as single assets (no splitting)
   */
  const processSVGFile = async (file: File, basePosition: XYPosition) => {
    try {
      const shapeAsset = await createShapeAssetFromSVGFile(file);
      addAsset(shapeAsset);

      const layer = createLayer(shapeAsset.id, shapeAsset.name, 1);
      addLayer(layer);

      const sourceNode = createSourceNode(layer.id, basePosition);
      addNode(sourceNode);

      console.log(`[Importer] Created SVG: ${shapeAsset.name}`);
      return 1;
    } catch (error) {
      console.error(`[Importer] Failed to process SVG ${file.name}:`, error);
      return 0;
    }
  };

  /**
   * CORE FUNCTION: Handles both Files and Directory Entries
   */
  const importResources = useCallback(async ({ files = [], entries = [], basePosition }: ImportOptions) => {
    // Track items that need deferred processing (video/image)
    const processingFiles: Array<{ file: File; assetId: string; nodeId: string; layerId: string }> = [];
    const processingSequences: Array<{ sequence: DetectedSequence; assetId: string; nodeId: string; layerId: string }> = [];
    
    let svgItemsProcessed = 0;
    let nodeIndex = 0;

    // --- 1. Process Directory Entries (Folder Drops) ---
    for (const entry of entries) {
        if (entry.isDirectory) {
          const dirFiles = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
          const sequences = detectImageSequences(dirFiles);
  
          if (sequences.length > 0) {
            const sequence = sequences[0];
            const placeholderAsset = createPlaceholderSequenceAsset(sequence);
            addAsset(placeholderAsset);
  
            const layer = createLayer(placeholderAsset.id, placeholderAsset.name, sequence.frameCount);
            addLayer(layer);
  
            const offsetPosition = {
              x: basePosition.x + nodeIndex * 250,
              y: basePosition.y + nodeIndex * 50,
            };
  
            const sourceNode = createSourceNode(layer.id, offsetPosition);
            addNode(sourceNode);
  
            processingSequences.push({
              sequence,
              assetId: placeholderAsset.id,
              nodeId: sourceNode.id,
              layerId: layer.id,
            });
            nodeIndex++;
          }
        } else if (entry.isFile) {
             // Handle single files inside the entries array (uncommon but possible in some D&D contexts)
             // We can technically just ignore this if we assume single files come through the `files` array
        }
    }

    // --- 2. Process Flat Files (Input or D&D) ---
    for (const file of files) {
      const offsetPosition = {
        x: basePosition.x + nodeIndex * 250,
        y: basePosition.y + nodeIndex * 50,
      };

      if (isSVGFile(file)) {
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

    // --- 3. Background Processing ---
    const totalItems = processingFiles.length + processingSequences.length;

    if (totalItems === 0 && svgItemsProcessed === 0) return;
    if (totalItems === 0) return; // Only SVGs were handled

    setState({
      isProcessing: true,
      progress: { current: 0, total: totalItems },
      error: null,
    });

    let completed = 0;
    let maxFrameCount = frameEnd;

    // Process Files
    for (const { file, assetId, layerId } of processingFiles) {
      try {
        updateAsset(assetId, { loadingState: { isLoading: true, progress: 0 } });

        const processedAsset = await createAssetFromFile(file, {
          onProgress: (current, total) => {
            const progress = total > 0 ? current / total : 0;
            updateAsset(assetId, { loadingState: { isLoading: true, progress } });
          },
        });

        updateAsset(assetId, {
          intrinsicWidth: processedAsset.intrinsicWidth,
          intrinsicHeight: processedAsset.intrinsicHeight,
          metadata: processedAsset.metadata,
          loadingState: undefined,
        });

        const actualFrameCount = getAssetFrameCount(processedAsset);
        updateLayer(layerId, {
          timeRange: { inFrame: 1, outFrame: actualFrameCount + 1, sourceOffset: 0 },
        });

        if (actualFrameCount > maxFrameCount) maxFrameCount = actualFrameCount;

        completed++;
        setState((prev) => ({ ...prev, progress: { current: completed, total: totalItems } }));

      } catch (error) {
        console.error(`Failed to process file ${file.name}:`, error);
        updateAsset(assetId, {
          loadingState: { isLoading: false, error: error instanceof Error ? error.message : 'Processing failed' },
        });
      }
    }

    // Process Sequences
    for (const { sequence, assetId, layerId } of processingSequences) {
      try {
        updateAsset(assetId, { loadingState: { isLoading: true, progress: 0 } });

        const processedAsset = await createImageSequenceAsset(sequence, {
          fps: 24,
          onProgress: (current, total) => {
            const progress = total > 0 ? current / total : 0;
            updateAsset(assetId, { loadingState: { isLoading: true, progress } });
          },
        });

        updateAsset(assetId, {
          intrinsicWidth: processedAsset.intrinsicWidth,
          intrinsicHeight: processedAsset.intrinsicHeight,
          metadata: processedAsset.metadata,
          loadingState: undefined,
        });

        const actualFrameCount = getAssetFrameCount(processedAsset);
        updateLayer(layerId, {
          timeRange: { inFrame: 1, outFrame: actualFrameCount + 1, sourceOffset: 0 },
        });

        if (actualFrameCount > maxFrameCount) maxFrameCount = actualFrameCount;

        completed++;
        setState((prev) => ({ ...prev, progress: { current: completed, total: totalItems } }));
      } catch (error) {
        console.error(`Failed to process sequence:`, error);
        updateAsset(assetId, {
          loadingState: { isLoading: false, error: error instanceof Error ? error.message : 'Processing failed' },
        });
      }
    }

    if (maxFrameCount > frameEnd) {
      setFrameRange(1, maxFrameCount);
    }

    setState({ isProcessing: false, progress: null, error: null });

  }, [addAsset, updateAsset, addNode, addLayer, updateLayer, setFrameRange, frameEnd]);

  return {
    importResources,
    importState: state,
  };
}