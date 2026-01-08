/**
 * useGPURenderer Hook
 *
 * Provides GPU-accelerated rendering for the FrameScrubber.
 * Handles WebGL context, texture management, and effect pipeline.
 *
 * Architecture:
 * - When no effects: Uses 2D canvas directly for fastest rendering
 * - When effects enabled: Uses GPU pipeline, renders to WebGL canvas,
 *   then transfers to visible canvas via drawImage
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { RenderPipeline } from '../gpu/RenderPipeline';
import { WebGLContext } from '../gpu/WebGLContext';
import { TexturePool } from '../gpu/TexturePool';
import type { RenderNode } from '../gpu/RenderPipeline';
import type { GPUTexture } from '../gpu/types';
import type { EffectConfig } from '../types/nodes';

// Import effects to register them
import '../gpu/effects/ColorAdjustEffect';
import '../gpu/effects/GaussianBlurEffect';

interface UseGPURendererOptions {
  width: number;
  height: number;
  effects?: EffectConfig[];
}

interface GPURendererState {
  isReady: boolean;
  error: string | null;
}

interface GPURendererActions {
  /**
   * Render an ImageBitmap through the effect pipeline
   * @param bitmap The source image
   * @param frameIndex Current frame index (for caching)
   */
  renderFrame: (bitmap: ImageBitmap, frameIndex: number) => void;

  /**
   * Mark effects as dirty (forces re-render on next frame)
   */
  markEffectsDirty: () => void;

  /**
   * Clear all cached textures
   */
  clearCache: () => void;
}

export function useGPURenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: UseGPURendererOptions
): [GPURendererState, GPURendererActions] {
  const { width, height, effects = [] } = options;

  // Refs for GPU resources (own context per renderer for isolation)
  const glContextRef = useRef<WebGLContext | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const texturePoolRef = useRef<TexturePool | null>(null);
  const pipelineRef = useRef<RenderPipeline | null>(null);
  const sourceTextureRef = useRef<GPUTexture | null>(null);
  const isReadyRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  // Store effects in ref to avoid renderFrame dependency changes
  const effectsRef = useRef<EffectConfig[]>(effects);
  effectsRef.current = effects;

  // Store dimensions in ref
  const dimensionsRef = useRef({ width, height });
  dimensionsRef.current = { width, height };

  // Initialize GPU context lazily (only when effects are used)
  const initGPU = useCallback(async () => {
    if (glContextRef.current || initPromiseRef.current) {
      return initPromiseRef.current;
    }

    initPromiseRef.current = (async () => {
      try {
        // Create a separate canvas for WebGL (hidden, used for GPU rendering)
        const glCanvas = document.createElement('canvas');
        const dims = dimensionsRef.current;
        glCanvas.width = dims.width || 1920;
        glCanvas.height = dims.height || 1080;
        glCanvasRef.current = glCanvas;

        // Create WebGL context
        const glContext = new WebGLContext();
        await glContext.init({
          canvas: glCanvas,
          preserveDrawingBuffer: true,
        });
        glContextRef.current = glContext;

        // Create texture pool
        const pool = new TexturePool(glContext, {
          maxTextures: 32,
          maxMemoryBytes: 256 * 1024 * 1024, // 256MB per renderer
        });
        texturePoolRef.current = pool;

        // Create pipeline
        pipelineRef.current = new RenderPipeline(glContext, pool);

        isReadyRef.current = true;
        errorRef.current = null;

        console.log('[useGPURenderer] GPU initialized');
      } catch (err) {
        console.error('[useGPURenderer] GPU init error:', err);
        errorRef.current = err instanceof Error ? err.message : 'GPU init failed';
        isReadyRef.current = false;
      }
    })();

    return initPromiseRef.current;
  }, []); // No dependencies - uses refs

  // Resize WebGL canvas when dimensions change
  useEffect(() => {
    if (glCanvasRef.current && width > 0 && height > 0) {
      glCanvasRef.current.width = width;
      glCanvasRef.current.height = height;
    }

    // Release source texture if dimensions changed
    if (sourceTextureRef.current && texturePoolRef.current) {
      if (
        sourceTextureRef.current.width !== width ||
        sourceTextureRef.current.height !== height
      ) {
        texturePoolRef.current.release(sourceTextureRef.current);
        sourceTextureRef.current = null;
      }
    }
  }, [width, height]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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

  // Render a frame through the GPU pipeline (stable callback using refs)
  const renderFrame = useCallback(
    async (bitmap: ImageBitmap, frameIndex: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Get enabled effects from ref
      const enabledEffects = effectsRef.current.filter((e) => e.enabled);

      // Fast path: no effects, use 2D canvas directly
      if (enabledEffects.length === 0) {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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
        // Fallback to 2D if GPU failed
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        }
        return;
      }

      try {
        const dims = dimensionsRef.current;

        // Ensure source texture exists
        if (!sourceTextureRef.current) {
          sourceTextureRef.current = pool.acquire(dims.width, dims.height, 'rgba8');
        }

        if (!sourceTextureRef.current) {
          throw new Error('Failed to acquire source texture');
        }

        // Upload bitmap to GPU
        glContext.uploadImageBitmap(bitmap, sourceTextureRef.current);

        // Build render node chain
        const renderNodes: RenderNode[] = enabledEffects.map((effect, index) => ({
          id: effect.id,
          effectName: effect.effectName,
          parameters: effect.parameters as Record<string, number | number[]>,
          inputIds: index === 0 ? ['source'] : [enabledEffects[index - 1].id],
        }));

        // Evaluate pipeline
        const result = pipeline.evaluate(
          renderNodes,
          sourceTextureRef.current,
          frameIndex
        );

        // Blit result to WebGL canvas
        glContext.resize(glCanvas.width, glCanvas.height);
        glContext.blitToCanvas(result);

        // Transfer WebGL canvas to visible 2D canvas (flip Y to correct orientation)
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.save();
          ctx2d.scale(1, -1);
          ctx2d.drawImage(glCanvas, 0, -canvas.height, canvas.width, canvas.height);
          ctx2d.restore();
        }
      } catch (err) {
        console.error('[useGPURenderer] Render error:', err);

        // Fallback to 2D rendering
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        }
      }
    },
    [canvasRef, initGPU] // Minimal dependencies - uses refs for everything else
  );

  // Mark effects as dirty (stable reference)
  const markEffectsDirty = useCallback(() => {
    pipelineRef.current?.markAllDirty();
  }, []);

  // Clear cache (stable reference)
  const clearCache = useCallback(() => {
    pipelineRef.current?.clearAll();
  }, []);

  // Memoize the state object
  const state = useMemo<GPURendererState>(() => ({
    isReady: isReadyRef.current,
    error: errorRef.current,
  }), []);

  // Memoize the actions object for stable reference
  const actions = useMemo<GPURendererActions>(() => ({
    renderFrame,
    markEffectsDirty,
    clearCache,
  }), [renderFrame, markEffectsDirty, clearCache]);

  return [state, actions] as const;
}
