/**
 * useDragAndDropFiles Hook
 *
 * Handles file drag and drop to create assets and source nodes.
 * Uses the new Asset/Layer/Node architecture.
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
  isVideoFile,
  isImageFile,
} from '../utils/asset-factory';
import { createSourceNode, type SourceNode } from '../types/scene-graph';
import { getAssetFrameCount } from '../types/assets';

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

  const handleFileDrop = useCallback(
    async (event: React.DragEvent, position: XYPosition) => {
      event.preventDefault();

      const files = Array.from(event.dataTransfer.files);

      // Filter to only supported files
      const supportedFiles = files.filter(
        (file) => isVideoFile(file) || isImageFile(file)
      );

      if (supportedFiles.length === 0) {
        console.warn('No supported files dropped');
        return;
      }

      const flowPosition = screenToFlowPosition(position);

      // Track files being processed (including node ID for updates)
      const processingFiles: Array<{ file: File; assetId: string; nodeId: string }> = [];

      // STEP 1: Immediately create placeholder assets and spawn nodes
      for (let i = 0; i < supportedFiles.length; i++) {
        const file = supportedFiles[i];

        // Create placeholder asset (marked as loading)
        const placeholderAsset = createPlaceholderAsset(file);

        // Add placeholder asset to store immediately
        addAsset(placeholderAsset);

        // Calculate offset position for this node
        const offsetPosition = {
          x: flowPosition.x + i * 250,
          y: flowPosition.y + i * 50,
        };

        // Create source node pointing to the placeholder asset
        // Use a default frame count of 300 (10 seconds at 30fps) for videos
        const defaultFrameCount = isVideoFile(file) ? 300 : 1;
        const sourceNode = createSourceNode(
          placeholderAsset.id,
          placeholderAsset.name,
          defaultFrameCount,
          offsetPosition
        );

        // Add source node to graph immediately
        addNode(sourceNode);

        processingFiles.push({ file, assetId: placeholderAsset.id, nodeId: sourceNode.id });

        console.log(`[DragAndDrop] Created placeholder node for: ${file.name}`);
      }

      // STEP 2: Process files in the background
      setState({
        isProcessing: true,
        progress: { current: 0, total: processingFiles.length },
        error: null,
      });

      let completed = 0;

      // Track the maximum frame count to update timeline
      let maxFrameCount = frameEnd;

      for (const { file, assetId, nodeId } of processingFiles) {
        try {
          // Update progress on the placeholder
          updateAsset(assetId, {
            loadingState: { isLoading: true, progress: 0 },
          });

          // Process the file (stores to OPFS, extracts frames for video)
          const processedAsset = await createAssetFromFile(file, {
            onProgress: (current, total) => {
              // Update progress on the asset
              const progress = total > 0 ? current / total : 0;
              updateAsset(assetId, {
                loadingState: { isLoading: true, progress },
              });
            },
          });

          // Update the placeholder asset with the real data
          // Keep the same ID so the node reference stays valid
          updateAsset(assetId, {
            intrinsicWidth: processedAsset.intrinsicWidth,
            intrinsicHeight: processedAsset.intrinsicHeight,
            metadata: processedAsset.metadata,
            loadingState: undefined, // Clear loading state
          });

          // Get the actual frame count from the processed asset
          const actualFrameCount = getAssetFrameCount(processedAsset);

          // Update the node's layer.timeRange to match the actual frame count
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

          // Track max frame count for timeline update
          if (actualFrameCount > maxFrameCount) {
            maxFrameCount = actualFrameCount;
          }

          completed++;
          setState((prev) => ({
            ...prev,
            progress: { current: completed, total: processingFiles.length },
          }));

          console.log(`[DragAndDrop] Finished processing: ${file.name} (${actualFrameCount} frames)`);
        } catch (error) {
          console.error(`Failed to process file ${file.name}:`, error);

          // Update asset with error state
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

      // Update timeline range if we have longer videos
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
