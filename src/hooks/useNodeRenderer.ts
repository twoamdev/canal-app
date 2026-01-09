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
import { useTimelineStore } from '../stores/timelineStore';
import { loadFrameFromOPFS, getFramePath, type FrameFormat } from '../utils/frame-storage';
import { opfsManager } from '../utils/opfs';
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
  frameCount: number;
  currentFrameIndex: number;
  dimensions: { width: number; height: number } | null;
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

  // Map global frame to source frame using time range
  const mapGlobalToSourceFrame = useCallback(
    (globalFrame: number): number | null => {
      if (!upstreamChain.sourceNode) return null;
      return getSourceFrameForGlobalFrame(
        upstreamChain.sourceNode,
        globalFrame,
        { start: frameStart, end: frameEnd }
      );
    },
    [upstreamChain.sourceNode, frameStart, frameEnd]
  );

  // Initialize GPU lazily
  const initGPU = useCallback(async () => {
    if (glContextRef.current || initPromiseRef.current) {
      return initPromiseRef.current;
    }

    if (!sourceDimensions) return;

    initPromiseRef.current = (async () => {
      try {
        const glCanvas = document.createElement('canvas');
        glCanvas.width = sourceDimensions.width;
        glCanvas.height = sourceDimensions.height;
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
        console.log('[useNodeRenderer] GPU initialized for node:', nodeId);
      } catch (err) {
        console.error('[useNodeRenderer] GPU init error:', err);
        isReadyRef.current = false;
      }
    })();

    return initPromiseRef.current;
  }, [nodeId, sourceDimensions]);

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
      if (!canvas || !sourceFrameInfo || !sourceDimensions) return;

      currentFrameRef.current = frameIndex;

      // Load frame from cache or OPFS
      let bitmap = frameCacheRef.current.get(frameIndex);
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

      // If no effects, just draw directly
      if (upstreamChain.effectConfigs.length === 0) {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          canvas.width = sourceDimensions.width;
          canvas.height = sourceDimensions.height;
          ctx2d.drawImage(bitmap, 0, 0);
        }
        return;
      }

      // Initialize GPU if needed
      if (!isReadyRef.current) {
        await initGPU();
      }

      const glContext = glContextRef.current;
      const glCanvas = glCanvasRef.current;
      const pool = texturePoolRef.current;
      const pipeline = pipelineRef.current;

      if (!glContext || !glCanvas || !pool || !pipeline) {
        // Fallback to 2D
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          canvas.width = sourceDimensions.width;
          canvas.height = sourceDimensions.height;
          ctx2d.drawImage(bitmap, 0, 0);
        }
        return;
      }

      try {
        // Ensure WebGL canvas matches source dimensions
        if (glCanvas.width !== sourceDimensions.width || glCanvas.height !== sourceDimensions.height) {
          glCanvas.width = sourceDimensions.width;
          glCanvas.height = sourceDimensions.height;
        }

        // Ensure source texture matches dimensions (re-acquire if needed)
        if (sourceTextureRef.current) {
          if (
            sourceTextureRef.current.width !== sourceDimensions.width ||
            sourceTextureRef.current.height !== sourceDimensions.height
          ) {
            pool.release(sourceTextureRef.current);
            sourceTextureRef.current = null;
          }
        }

        if (!sourceTextureRef.current) {
          sourceTextureRef.current = pool.acquire(
            sourceDimensions.width,
            sourceDimensions.height,
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
        glContext.resize(sourceDimensions.width, sourceDimensions.height);
        glContext.blitToCanvas(result);

        // Transfer to visible canvas (flip Y)
        canvas.width = sourceDimensions.width;
        canvas.height = sourceDimensions.height;
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.save();
          ctx2d.scale(1, -1);
          ctx2d.drawImage(glCanvas, 0, -canvas.height, canvas.width, canvas.height);
          ctx2d.restore();
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
    [canvasRef, sourceFrameInfo, sourceDimensions, upstreamChain, initGPU]
  );

  const getCurrentFrameIndex = useCallback(() => {
    return currentFrameRef.current;
  }, []);

  // Check if source is active at a global frame
  const isActiveAtFrame = useCallback(
    (globalFrame: number): boolean => {
      const sourceFrame = mapGlobalToSourceFrame(globalFrame);
      return sourceFrame !== null;
    },
    [mapGlobalToSourceFrame]
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

  // State
  const state = useMemo<NodeRendererState>(
    () => ({
      isReady: isReadyRef.current,
      hasSource: upstreamChain.isComplete,
      sourceNodeId: upstreamChain.sourceNode?.id ?? null,
      frameCount: sourceFrameInfo?.frameCount ?? 0,
      currentFrameIndex: sourceFrameInfo?.currentFrameIndex ?? 0,
      dimensions: sourceDimensions,
    }),
    [upstreamChain, sourceFrameInfo, sourceDimensions]
  );

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
