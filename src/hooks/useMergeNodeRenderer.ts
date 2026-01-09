/**
 * useMergeNodeRenderer Hook
 *
 * Renders the output of a merge node with two inputs (bg and fg).
 * Uses GPU-accelerated compositing with blend modes.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { WebGLContext } from '../gpu/WebGLContext';
import { TexturePool } from '../gpu/TexturePool';
import { effectRegistry } from '../gpu/effects/registry';
import {
  findMultiInputUpstreamChains,
  getMergeOutputDimensions,
  getSourceFrameInfo,
  getSourceDimensions,
} from '../utils/graph-traversal';
import { getSourceFrameForGlobalFrame } from '../utils/node-time';
import { getEffectiveTimeRange, getLayersAtNode } from '../utils/layer-metadata';
import { useTimelineStore } from '../stores/timelineStore';
import { loadFrameFromOPFS, getFramePath, type FrameFormat } from '../utils/frame-storage';
import { opfsManager } from '../utils/opfs';
import { useRenderedOutputStore } from '../stores/renderedOutputStore';
import type { GPUTexture } from '../gpu/types';
import type { MergeNodeData, MergeBlendMode } from '../types/nodes';

// Import merge effect to register it
import '../gpu/effects/MergeEffect';
import { BLEND_MODE_MAP } from '../gpu/effects/MergeEffect';

interface UseMergeNodeRendererOptions {
  nodeId: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

interface MergeNodeRendererState {
  isReady: boolean;
  hasBg: boolean;
  hasFg: boolean;
  hasBothInputs: boolean;
  bgDimensions: { width: number; height: number } | null;
  fgDimensions: { width: number; height: number } | null;
  dimensions: { width: number; height: number } | null; // Output = bg
  /** Union time range from layer metadata (max of all input ranges) */
  timeRange: { inFrame: number; outFrame: number } | null;
  /** Number of layers in the stack */
  layerCount: number;
}

interface MergeNodeRendererActions {
  /** Render a frame. Set updateCanvas=false to only compute output without updating visible canvas */
  renderGlobalFrame: (globalFrame: number, updateCanvas?: boolean) => Promise<boolean>;
}

export function useMergeNodeRenderer(
  options: UseMergeNodeRendererOptions
): [MergeNodeRendererState, MergeNodeRendererActions] {
  const { nodeId, canvasRef } = options;

  // Get nodes and edges from store
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);

  // GPU resources
  const glContextRef = useRef<WebGLContext | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const texturePoolRef = useRef<TexturePool | null>(null);
  const bgTextureRef = useRef<GPUTexture | null>(null);
  const fgTextureRef = useRef<GPUTexture | null>(null);
  const outputTextureRef = useRef<GPUTexture | null>(null);
  const isReadyRef = useRef(false);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  // Frame caches for both inputs
  const bgFrameCacheRef = useRef<Map<number, ImageBitmap>>(new Map());
  const fgFrameCacheRef = useRef<Map<number, ImageBitmap>>(new Map());

  // Timeline
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);

  // Rendered output store - for sharing output with downstream nodes
  const setRenderedOutput = useRenderedOutputStore((state) => state.setOutput);

  // Compute upstream chains for both inputs
  const multiChains = useMemo(() => {
    return findMultiInputUpstreamChains(nodeId, nodes, edges);
  }, [nodeId, nodes, edges]);

  const bgChain = multiChains.chains.get('bg');
  const fgChain = multiChains.chains.get('fg');

  const bgSourceInfo = useMemo(() => {
    return bgChain?.sourceNode ? getSourceFrameInfo(bgChain.sourceNode) : null;
  }, [bgChain?.sourceNode]);

  const fgSourceInfo = useMemo(() => {
    return fgChain?.sourceNode ? getSourceFrameInfo(fgChain.sourceNode) : null;
  }, [fgChain?.sourceNode]);

  const bgDimensions = useMemo(() => {
    return bgChain?.sourceNode ? getSourceDimensions(bgChain.sourceNode) : null;
  }, [bgChain?.sourceNode]);

  const fgDimensions = useMemo(() => {
    return fgChain?.sourceNode ? getSourceDimensions(fgChain.sourceNode) : null;
  }, [fgChain?.sourceNode]);

  // Output dimensions = bg dimensions
  const outputDimensions = useMemo(() => {
    return getMergeOutputDimensions(nodeId, nodes, edges);
  }, [nodeId, nodes, edges]);

  // Get effective time range from layer metadata (union of all input ranges)
  const effectiveTimeRange = useMemo(() => {
    return getEffectiveTimeRange(nodeId, nodes, edges, {
      start: frameStart,
      end: frameEnd,
    });
  }, [nodeId, nodes, edges, frameStart, frameEnd]);

  // Get layer stack info
  const layerStack = useMemo(() => {
    return getLayersAtNode(nodeId, nodes, edges, {
      start: frameStart,
      end: frameEnd,
    });
  }, [nodeId, nodes, edges, frameStart, frameEnd]);

  // Get the current node's parameters
  const currentNode = useMemo(() => {
    return nodes.find((n) => n.id === nodeId);
  }, [nodes, nodeId]);

  const mergeParams = (currentNode?.data as MergeNodeData | undefined)?.parameters;

  // Initialize GPU lazily
  const initGPU = useCallback(async () => {
    if (glContextRef.current || initPromiseRef.current) {
      return initPromiseRef.current;
    }

    if (!outputDimensions) return;

    initPromiseRef.current = (async () => {
      try {
        const glCanvas = document.createElement('canvas');
        glCanvas.width = outputDimensions.width;
        glCanvas.height = outputDimensions.height;
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

        isReadyRef.current = true;
        console.log('[useMergeNodeRenderer] GPU initialized for node:', nodeId);
      } catch (err) {
        console.error('[useMergeNodeRenderer] GPU init error:', err);
        isReadyRef.current = false;
      }
    })();

    return initPromiseRef.current;
  }, [nodeId, outputDimensions]);

  // Cleanup
  useEffect(() => {
    return () => {
      bgFrameCacheRef.current.forEach((b) => b.close());
      fgFrameCacheRef.current.forEach((b) => b.close());
      bgFrameCacheRef.current.clear();
      fgFrameCacheRef.current.clear();

      if (bgTextureRef.current && texturePoolRef.current) {
        texturePoolRef.current.release(bgTextureRef.current);
        bgTextureRef.current = null;
      }
      if (fgTextureRef.current && texturePoolRef.current) {
        texturePoolRef.current.release(fgTextureRef.current);
        fgTextureRef.current = null;
      }
      if (outputTextureRef.current && texturePoolRef.current) {
        texturePoolRef.current.release(outputTextureRef.current);
        outputTextureRef.current = null;
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

  // Load a frame from source info
  const loadFrame = useCallback(
    async (
      sourceInfo: { sourceType: string; opfsPath: string; format: string },
      frameIndex: number,
      cache: Map<number, ImageBitmap>
    ): Promise<ImageBitmap | null> => {
      let bitmap = cache.get(frameIndex);
      if (bitmap) return bitmap;

      try {
        if (sourceInfo.sourceType === 'video') {
          const framePath = getFramePath(
            sourceInfo.opfsPath,
            frameIndex,
            sourceInfo.format as FrameFormat
          );
          bitmap = await loadFrameFromOPFS(framePath);
        } else {
          const imageFile = await opfsManager.getFile(sourceInfo.opfsPath);
          bitmap = await createImageBitmap(imageFile);
        }

        cache.set(frameIndex, bitmap);

        // Simple cache limit
        if (cache.size > 30) {
          const firstKey = cache.keys().next().value;
          if (firstKey !== undefined) {
            cache.get(firstKey)?.close();
            cache.delete(firstKey);
          }
        }

        return bitmap;
      } catch (err) {
        console.error('[useMergeNodeRenderer] Failed to load frame:', err);
        return null;
      }
    },
    []
  );

  const renderGlobalFrame = useCallback(
    async (globalFrame: number, updateCanvas: boolean = true): Promise<boolean> => {
      const canvas = canvasRef.current;
      if (!canvas || !bgSourceInfo || !fgSourceInfo || !outputDimensions || !mergeParams) {
        return false;
      }

      if (!bgDimensions || !fgDimensions) {
        return false;
      }

      // Map global frame to source frames
      const bgSourceFrame = bgChain?.sourceNode
        ? getSourceFrameForGlobalFrame(bgChain.sourceNode, globalFrame, {
            start: frameStart,
            end: frameEnd,
          })
        : null;
      const fgSourceFrame = fgChain?.sourceNode
        ? getSourceFrameForGlobalFrame(fgChain.sourceNode, globalFrame, {
            start: frameStart,
            end: frameEnd,
          })
        : null;

      // If bg is inactive, clear canvas (can't render without bg)
      if (bgSourceFrame === null) {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        }
        return false;
      }

      // Load bg frame (always needed)
      const bgBitmap = await loadFrame(bgSourceInfo, bgSourceFrame, bgFrameCacheRef.current);
      if (!bgBitmap) {
        return false;
      }

      // Load fg frame only if active
      let fgBitmap: ImageBitmap | null = null;
      if (fgSourceFrame !== null) {
        fgBitmap = await loadFrame(fgSourceInfo, fgSourceFrame, fgFrameCacheRef.current);
      }

      // Initialize GPU if needed
      if (!isReadyRef.current) {
        await initGPU();
      }

      const glContext = glContextRef.current;
      const glCanvas = glCanvasRef.current;
      const pool = texturePoolRef.current;

      // Helper to draw bg directly and store output (used in multiple places)
      const drawBgOnly = async () => {
        // Store rendered output for downstream nodes (always)
        try {
          const outputBitmap = await createImageBitmap(bgBitmap);
          setRenderedOutput(nodeId, outputBitmap, globalFrame);
        } catch (err) {
          console.warn('[useMergeNodeRenderer] Failed to store output bitmap:', err);
        }
        // Only update visible canvas if requested
        if (updateCanvas) {
          canvas.width = outputDimensions.width;
          canvas.height = outputDimensions.height;
          const ctx2d = canvas.getContext('2d');
          if (ctx2d) {
            ctx2d.drawImage(bgBitmap, 0, 0);
          }
        }
      };

      if (!glContext || !glCanvas || !pool) {
        // Fallback - just draw bg
        await drawBgOnly();
        return true;
      }

      // If fg is not available, just render bg directly (no GPU merge needed)
      if (!fgBitmap || !fgDimensions) {
        await drawBgOnly();
        return true;
      }

      try {
        // Ensure canvas size
        if (glCanvas.width !== outputDimensions.width || glCanvas.height !== outputDimensions.height) {
          glCanvas.width = outputDimensions.width;
          glCanvas.height = outputDimensions.height;
        }

        // Acquire/resize bg texture
        if (bgTextureRef.current) {
          if (
            bgTextureRef.current.width !== bgDimensions.width ||
            bgTextureRef.current.height !== bgDimensions.height
          ) {
            pool.release(bgTextureRef.current);
            bgTextureRef.current = null;
          }
        }
        if (!bgTextureRef.current) {
          bgTextureRef.current = pool.acquire(bgDimensions.width, bgDimensions.height, 'rgba8');
        }

        // Acquire/resize fg texture
        if (fgTextureRef.current) {
          if (
            fgTextureRef.current.width !== fgDimensions.width ||
            fgTextureRef.current.height !== fgDimensions.height
          ) {
            pool.release(fgTextureRef.current);
            fgTextureRef.current = null;
          }
        }
        if (!fgTextureRef.current) {
          fgTextureRef.current = pool.acquire(fgDimensions.width, fgDimensions.height, 'rgba8');
        }

        // Acquire/resize output texture
        if (outputTextureRef.current) {
          if (
            outputTextureRef.current.width !== outputDimensions.width ||
            outputTextureRef.current.height !== outputDimensions.height
          ) {
            pool.release(outputTextureRef.current);
            outputTextureRef.current = null;
          }
        }
        if (!outputTextureRef.current) {
          outputTextureRef.current = pool.acquire(
            outputDimensions.width,
            outputDimensions.height,
            'rgba8'
          );
        }

        if (!bgTextureRef.current || !fgTextureRef.current || !outputTextureRef.current) {
          throw new Error('Failed to acquire textures');
        }

        // Upload frames to textures
        glContext.uploadImageBitmap(bgBitmap, bgTextureRef.current);
        glContext.uploadImageBitmap(fgBitmap, fgTextureRef.current);

        // Get the merge effect
        const mergeEffect = effectRegistry.getCompiled('merge', glContext);

        // Set parameters
        const blendModeInt = BLEND_MODE_MAP[mergeParams.blendMode as MergeBlendMode] ?? 0;
        mergeEffect.setParameter('blendMode', blendModeInt);
        mergeEffect.setParameter('opacity', mergeParams.opacity);
        mergeEffect.setParameter('fgSize', [fgDimensions.width, fgDimensions.height]);

        // Apply the merge effect
        mergeEffect.apply(
          glContext,
          [bgTextureRef.current, fgTextureRef.current],
          outputTextureRef.current
        );

        // Blit to WebGL canvas (offscreen)
        glContext.resize(outputDimensions.width, outputDimensions.height);
        glContext.blitToCanvas(outputTextureRef.current);

        // Store rendered output for downstream nodes (always - from glCanvas with Y flip)
        try {
          // Create a temporary canvas for the flipped output
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = outputDimensions.width;
          tempCanvas.height = outputDimensions.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            tempCtx.save();
            tempCtx.scale(1, -1);
            tempCtx.drawImage(glCanvas, 0, -tempCanvas.height, tempCanvas.width, tempCanvas.height);
            tempCtx.restore();
          }
          const outputBitmap = await createImageBitmap(tempCanvas);
          setRenderedOutput(nodeId, outputBitmap, globalFrame);
        } catch (err) {
          console.warn('[useMergeNodeRenderer] Failed to store output bitmap:', err);
        }

        // Only update visible canvas if requested
        if (updateCanvas) {
          canvas.width = outputDimensions.width;
          canvas.height = outputDimensions.height;
          const ctx2d = canvas.getContext('2d');
          if (ctx2d) {
            ctx2d.save();
            ctx2d.scale(1, -1);
            ctx2d.drawImage(glCanvas, 0, -canvas.height, canvas.width, canvas.height);
            ctx2d.restore();
          }
        }

        return true;
      } catch (err) {
        console.error('[useMergeNodeRenderer] Render error:', err);

        // Fallback
        await drawBgOnly();
        return true;
      }
    },
    [
      canvasRef,
      nodeId,
      bgSourceInfo,
      fgSourceInfo,
      bgDimensions,
      fgDimensions,
      outputDimensions,
      mergeParams,
      bgChain,
      fgChain,
      frameStart,
      frameEnd,
      loadFrame,
      initGPU,
      setRenderedOutput,
    ]
  );

  // State
  const state = useMemo<MergeNodeRendererState>(
    () => ({
      isReady: isReadyRef.current,
      hasBg: bgChain?.isComplete ?? false,
      hasFg: fgChain?.isComplete ?? false,
      hasBothInputs: (bgChain?.isComplete ?? false) && (fgChain?.isComplete ?? false),
      bgDimensions,
      fgDimensions,
      dimensions: outputDimensions,
      timeRange: effectiveTimeRange,
      layerCount: layerStack?.length ?? 0,
    }),
    [bgChain, fgChain, bgDimensions, fgDimensions, outputDimensions, effectiveTimeRange, layerStack]
  );

  const actions = useMemo<MergeNodeRendererActions>(
    () => ({
      renderGlobalFrame,
    }),
    [renderGlobalFrame]
  );

  return [state, actions];
}
