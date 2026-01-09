/**
 * useNodeRenderer Hook
 *
 * Renders the output of a node by evaluating its upstream chain.
 * Used by effect nodes to preview their output.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { RenderPipeline } from '../gpu/RenderPipeline';
import { WebGLContext } from '../gpu/WebGLContext';
import { TexturePool } from '../gpu/TexturePool';
import {
  findUpstreamChain,
  getSourceFrameInfo,
  getSourceDimensions,
} from '../utils/graph-traversal';
import { getSourceFrameForGlobalFrame } from '../utils/node-time';
import { getEffectiveTimeRange } from '../utils/layer-metadata';
import { useTimelineStore } from '../stores/timelineStore';
import { loadFrameFromOPFS, getFramePath, type FrameFormat } from '../utils/frame-storage';
import { opfsManager } from '../utils/opfs';
import { useRenderedOutputStore } from '../stores/renderedOutputStore';
import type { RenderNode } from '../gpu/RenderPipeline';
import type { GPUTexture } from '../gpu/types';

// Import effects to register them
import '../gpu/effects/ColorAdjustEffect';
import '../gpu/effects/GaussianBlurEffect';

interface UseNodeRendererOptions {
  nodeId: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

interface NodeRendererState {
  isReady: boolean;
  hasSource: boolean;
  sourceNodeId: string | null;
  /** ID of composite source (merge) if upstream chain terminates at one */
  compositeSourceId: string | null;
  /** Whether the source is a composite (merge) */
  hasCompositeSource: boolean;
  /** Frame index of the composite source output (triggers re-render when it changes) */
  compositeSourceFrameIndex: number | null;
  frameCount: number;
  currentFrameIndex: number;
  dimensions: { width: number; height: number } | null;
  /** Effective time range from layer metadata (propagated from source) */
  timeRange: { inFrame: number; outFrame: number } | null;
}

interface NodeRendererActions {
  renderFrame: (frameIndex: number) => Promise<void>;
  renderGlobalFrame: (globalFrame: number) => Promise<boolean>; // Returns true if rendered, false if inactive
  getCurrentFrameIndex: () => number;
  isActiveAtFrame: (globalFrame: number) => boolean;
}

export function useNodeRenderer(
  options: UseNodeRendererOptions
): [NodeRendererState, NodeRendererActions] {
  const { nodeId, canvasRef } = options;

  // Get nodes and edges from store
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);

  // GPU resources (per-node isolation)
  const glContextRef = useRef<WebGLContext | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const texturePoolRef = useRef<TexturePool | null>(null);
  const pipelineRef = useRef<RenderPipeline | null>(null);
  const sourceTextureRef = useRef<GPUTexture | null>(null);
  const isReadyRef = useRef(false);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  // Frame cache
  const frameCacheRef = useRef<Map<number, ImageBitmap>>(new Map());
  const currentFrameRef = useRef(0);

  // Compute upstream chain
  const upstreamChain = useMemo(() => {
    return findUpstreamChain(nodeId, nodes, edges);
  }, [nodeId, nodes, edges]);

  // Get source info
  const sourceFrameInfo = useMemo(() => {
    if (!upstreamChain.sourceNode) return null;
    return getSourceFrameInfo(upstreamChain.sourceNode);
  }, [upstreamChain.sourceNode]);

  const sourceDimensions = useMemo(() => {
    if (!upstreamChain.sourceNode) return null;
    return getSourceDimensions(upstreamChain.sourceNode);
  }, [upstreamChain.sourceNode]);

  // Get global timeline range
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);

  // Rendered output store - for getting and setting composite source outputs
  const getRenderedOutput = useRenderedOutputStore((state) => state.getOutput);
  const setRenderedOutput = useRenderedOutputStore((state) => state.setOutput);

  // Composite source info (if upstream chain ends at a merge)
  const compositeSourceId = upstreamChain.compositeSourceNode?.id ?? null;

  // Subscribe to the composite source output - this will trigger re-render when merge output changes
  const compositeSourceOutput = useRenderedOutputStore((state) =>
    compositeSourceId ? state.outputs.get(compositeSourceId) : undefined
  );

  // Get effective time range from layer metadata (propagated through chain)
  const effectiveTimeRange = useMemo(() => {
    return getEffectiveTimeRange(nodeId, nodes, edges, {
      start: frameStart,
      end: frameEnd,
    });
  }, [nodeId, nodes, edges, frameStart, frameEnd]);

  // Map global frame to source frame using time range
  const mapGlobalToSourceFrame = useCallback(
    (globalFrame: number): number | null => {
      // For composite sources (merge), just pass through the global frame
      // The composite source handles its own time mapping
      if (upstreamChain.hasCompositeSource) {
        return globalFrame;
      }
      if (!upstreamChain.sourceNode) return null;
      return getSourceFrameForGlobalFrame(
        upstreamChain.sourceNode,
        globalFrame,
        { start: frameStart, end: frameEnd }
      );
    },
    [upstreamChain.sourceNode, upstreamChain.hasCompositeSource, frameStart, frameEnd]
  );

  // Initialize GPU lazily - supports both primary sources and composite sources
  const initGPU = useCallback(async (overrideDimensions?: { width: number; height: number }) => {
    if (glContextRef.current || initPromiseRef.current) {
      return initPromiseRef.current;
    }

    // Use override dimensions, or sourceDimensions, or composite source dimensions
    const compositeDims = compositeSourceOutput
      ? { width: compositeSourceOutput.width, height: compositeSourceOutput.height }
      : null;
    const dims = overrideDimensions ?? sourceDimensions ?? compositeDims;

    if (!dims) return;

    initPromiseRef.current = (async () => {
      try {
        const glCanvas = document.createElement('canvas');
        glCanvas.width = dims.width;
        glCanvas.height = dims.height;
        glCanvasRef.current = glCanvas;

        const glContext = new WebGLContext();
        await glContext.init({
          canvas: glCanvas,
          preserveDrawingBuffer: true,
        });
        glContextRef.current = glContext;

        const pool = new TexturePool(glContext, {
          maxTextures: 32,
          maxMemoryBytes: 256 * 1024 * 1024,
        });
        texturePoolRef.current = pool;

        pipelineRef.current = new RenderPipeline(glContext, pool);

        isReadyRef.current = true;
        console.log('[useNodeRenderer] GPU initialized for node:', nodeId, 'with dimensions:', dims);
      } catch (err) {
        console.error('[useNodeRenderer] GPU init error:', err);
        isReadyRef.current = false;
      }
    })();

    return initPromiseRef.current;
  }, [nodeId, sourceDimensions, compositeSourceOutput]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Close cached bitmaps
      frameCacheRef.current.forEach((bitmap) => bitmap.close());
      frameCacheRef.current.clear();

      // Cleanup GPU resources
      if (sourceTextureRef.current && texturePoolRef.current) {
        texturePoolRef.current.release(sourceTextureRef.current);
        sourceTextureRef.current = null;
      }
      if (pipelineRef.current) {
        pipelineRef.current.clearAll();
        pipelineRef.current = null;
      }
      if (texturePoolRef.current) {
        texturePoolRef.current.clearAll();
        texturePoolRef.current = null;
      }
      if (glContextRef.current) {
        glContextRef.current.dispose();
        glContextRef.current = null;
      }
      glCanvasRef.current = null;
      initPromiseRef.current = null;
    };
  }, []);

  // Render a frame through the upstream chain
  const renderFrame = useCallback(
    async (frameIndex: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      currentFrameRef.current = frameIndex;

      // Determine the input bitmap and dimensions based on source type
      let bitmap: ImageBitmap | null = null;
      let inputDimensions: { width: number; height: number } | null = null;

      if (upstreamChain.hasCompositeSource && compositeSourceId) {
        // Get rendered output from composite source (merge node)
        const compositeOutput = getRenderedOutput(compositeSourceId);
        if (!compositeOutput) {
          console.warn('[useNodeRenderer] No composite source output available for:', compositeSourceId);
          return;
        }
        // Check if composite output matches the frame we're trying to render
        // If not, skip - we'll re-render when the composite source updates
        if (compositeOutput.frameIndex !== frameIndex) {
          console.log('[useNodeRenderer] Composite output frame mismatch:', compositeOutput.frameIndex, '!=', frameIndex, '- waiting for update');
          return;
        }
        bitmap = compositeOutput.bitmap;
        inputDimensions = { width: compositeOutput.width, height: compositeOutput.height };
      } else if (sourceFrameInfo && sourceDimensions) {
        // Load frame from primary source (video/image) via cache or OPFS
        inputDimensions = sourceDimensions;
        bitmap = frameCacheRef.current.get(frameIndex) ?? null;

        if (!bitmap) {
          try {
            if (sourceFrameInfo.sourceType === 'video') {
              // Load video frame from extracted frames
              const framePath = getFramePath(
                sourceFrameInfo.opfsPath,
                frameIndex,
                sourceFrameInfo.format as FrameFormat
              );
              bitmap = await loadFrameFromOPFS(framePath);
            } else {
              // Load image directly from OPFS
              const imageFile = await opfsManager.getFile(sourceFrameInfo.opfsPath);
              bitmap = await createImageBitmap(imageFile);
            }

            frameCacheRef.current.set(frameIndex, bitmap);

            // Simple cache limit
            if (frameCacheRef.current.size > 50) {
              const firstKey = frameCacheRef.current.keys().next().value;
              if (firstKey !== undefined) {
                frameCacheRef.current.get(firstKey)?.close();
                frameCacheRef.current.delete(firstKey);
              }
            }
          } catch (err) {
            console.error('[useNodeRenderer] Failed to load frame:', err);
            return;
          }
        }
      } else {
        // No valid source
        console.warn('[useNodeRenderer] No valid source for node:', nodeId);
        return;
      }

      if (!bitmap || !inputDimensions) {
        return;
      }

      // If no effects, just draw directly
      if (upstreamChain.effectConfigs.length === 0) {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          canvas.width = inputDimensions.width;
          canvas.height = inputDimensions.height;
          ctx2d.drawImage(bitmap, 0, 0);
        }
        // Store rendered output for downstream nodes
        try {
          const outputBitmap = await createImageBitmap(canvas);
          setRenderedOutput(nodeId, outputBitmap, frameIndex);
        } catch (storeErr) {
          console.warn('[useNodeRenderer] Failed to store output bitmap:', storeErr);
        }
        return;
      }

      // Initialize GPU if needed - pass actual dimensions from input
      if (!isReadyRef.current) {
        await initGPU(inputDimensions);
      }

      const glContext = glContextRef.current;
      const glCanvas = glCanvasRef.current;
      const pool = texturePoolRef.current;
      const pipeline = pipelineRef.current;

      if (!glContext || !glCanvas || !pool || !pipeline) {
        // Fallback to 2D
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          canvas.width = inputDimensions.width;
          canvas.height = inputDimensions.height;
          ctx2d.drawImage(bitmap, 0, 0);
        }
        return;
      }

      try {
        // Ensure WebGL canvas matches input dimensions
        if (glCanvas.width !== inputDimensions.width || glCanvas.height !== inputDimensions.height) {
          glCanvas.width = inputDimensions.width;
          glCanvas.height = inputDimensions.height;
        }

        // Ensure source texture matches dimensions (re-acquire if needed)
        if (sourceTextureRef.current) {
          if (
            sourceTextureRef.current.width !== inputDimensions.width ||
            sourceTextureRef.current.height !== inputDimensions.height
          ) {
            pool.release(sourceTextureRef.current);
            sourceTextureRef.current = null;
          }
        }

        if (!sourceTextureRef.current) {
          sourceTextureRef.current = pool.acquire(
            inputDimensions.width,
            inputDimensions.height,
            'rgba8'
          );
        }

        if (!sourceTextureRef.current) {
          throw new Error('Failed to acquire source texture');
        }

        // Upload frame
        glContext.uploadImageBitmap(bitmap, sourceTextureRef.current);

        // Build render nodes from upstream chain
        const renderNodes: RenderNode[] = upstreamChain.effectConfigs.map(
          (effect, index) => ({
            id: effect.id,
            effectName: effect.effectName,
            parameters: effect.parameters as Record<string, number | number[]>,
            inputIds: index === 0 ? ['source'] : [upstreamChain.effectConfigs[index - 1].id],
          })
        );

        // Evaluate pipeline
        const result = pipeline.evaluate(
          renderNodes,
          sourceTextureRef.current,
          frameIndex
        );

        // Blit to WebGL canvas at full resolution
        glContext.resize(inputDimensions.width, inputDimensions.height);
        glContext.blitToCanvas(result);

        // Transfer to visible canvas (flip Y)
        canvas.width = inputDimensions.width;
        canvas.height = inputDimensions.height;
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.save();
          ctx2d.scale(1, -1);
          ctx2d.drawImage(glCanvas, 0, -canvas.height, canvas.width, canvas.height);
          ctx2d.restore();
        }

        // Store rendered output for downstream nodes
        try {
          const outputBitmap = await createImageBitmap(canvas);
          setRenderedOutput(nodeId, outputBitmap, frameIndex);
        } catch (storeErr) {
          console.warn('[useNodeRenderer] Failed to store output bitmap:', storeErr);
        }
      } catch (err) {
        console.error('[useNodeRenderer] Render error:', err);

        // Fallback
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.drawImage(bitmap, 0, 0);
        }
      }
    },
    [canvasRef, nodeId, sourceFrameInfo, sourceDimensions, upstreamChain, compositeSourceId, getRenderedOutput, setRenderedOutput, initGPU]
  );

  const getCurrentFrameIndex = useCallback(() => {
    return currentFrameRef.current;
  }, []);

  // Check if node is active at a global frame using layer metadata
  const isActiveAtFrame = useCallback(
    (globalFrame: number): boolean => {
      if (!effectiveTimeRange) return false;
      return globalFrame >= effectiveTimeRange.inFrame &&
             globalFrame < effectiveTimeRange.outFrame;
    },
    [effectiveTimeRange]
  );

  // Render a global frame (maps to source frame, handles inactive)
  const renderGlobalFrame = useCallback(
    async (globalFrame: number): Promise<boolean> => {
      const canvas = canvasRef.current;
      if (!canvas) return false;

      const sourceFrame = mapGlobalToSourceFrame(globalFrame);

      if (sourceFrame === null) {
        // Node is inactive - clear canvas to transparent
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        }
        return false;
      }

      await renderFrame(sourceFrame);
      return true;
    },
    [canvasRef, mapGlobalToSourceFrame, renderFrame]
  );

  // State - use composite source data when available and no primary source
  const state = useMemo<NodeRendererState>(() => {
    // If we have a composite source with output, use its data
    const hasCompositeOutput = !!compositeSourceOutput;
    const compositeDimensions = compositeSourceOutput
      ? { width: compositeSourceOutput.width, height: compositeSourceOutput.height }
      : null;

    return {
      isReady: isReadyRef.current,
      hasSource: upstreamChain.isComplete,
      sourceNodeId: upstreamChain.sourceNode?.id ?? null,
      compositeSourceId,
      hasCompositeSource: upstreamChain.hasCompositeSource,
      // Frame index of composite source output - changes trigger re-renders in dependent nodes
      compositeSourceFrameIndex: compositeSourceOutput?.frameIndex ?? null,
      // Use frameCount=1 for composite sources when output is available
      frameCount: sourceFrameInfo?.frameCount ?? (hasCompositeOutput ? 1 : 0),
      currentFrameIndex: sourceFrameInfo?.currentFrameIndex ?? 0,
      // Use composite dimensions when no primary source
      dimensions: sourceDimensions ?? compositeDimensions,
      timeRange: effectiveTimeRange,
    };
  }, [upstreamChain, sourceFrameInfo, sourceDimensions, effectiveTimeRange, compositeSourceId, compositeSourceOutput]);

  const actions = useMemo<NodeRendererActions>(
    () => ({
      renderFrame,
      renderGlobalFrame,
      getCurrentFrameIndex,
      isActiveAtFrame,
    }),
    [renderFrame, renderGlobalFrame, getCurrentFrameIndex, isActiveAtFrame]
  );

  return [state, actions];
}
