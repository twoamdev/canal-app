/**
 * useChainRenderer Hook
 *
 * Renders the upstream effect chain for a node, displaying the result
 * on a canvas. Used by both SourceNode (no effects) and OperationNode
 * (with effects applied).
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useAssetStore } from '../stores/assetStore';
import { useCompositionStore } from '../stores/compositionStore';
import { useTimelineStore } from '../stores/timelineStore';
import { useLayerStore } from '../stores/layerStore';
import { loadAssetFrame, mapGlobalFrameToSource, globalFrameCache } from '../utils/asset-loader';
import { findUpstreamChain, type SceneGraph } from '../utils/scene-graph-utils';
import { isRenderableAsset } from '../types/assets';
import { WebGLContext } from '../gpu/WebGLContext';
import { TexturePool } from '../gpu/TexturePool';
import { RenderPipeline, type RenderNode } from '../gpu/RenderPipeline';
// Import effects to ensure they are registered
import '../gpu/effects';
import type { OperationType, TransformParams, OperationNode } from '../types/scene-graph';
import type { UniformValue } from '../gpu/types';
import { DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT, drawCheckerboard } from '../components/viewers';
import { calculateTransformedBounds } from '../utils/transform-utils';

// Map operation types to GPU effect names (transform is handled separately via 2D canvas)
const OPERATION_TO_EFFECT: Record<OperationType, string> = {
  blur: 'gaussianBlur',
  color_correct: 'colorAdjust',
  transform: 'transform', // Not used for GPU, handled via 2D canvas
};

/**
 * Apply a transform operation to a canvas, expanding it to fit the transformed content.
 * Returns a new OffscreenCanvas with the transformed content.
 *
 * The canvas is sized to include both:
 * - The original source bounds (0,0 to sourceWidth,sourceHeight)
 * - The transformed content bounds (may extend beyond original in any direction)
 */
async function applyTransformOperation(
  sourceCanvas: OffscreenCanvas | HTMLCanvasElement,
  transformParams: TransformParams
): Promise<OffscreenCanvas> {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;

  // Ensure params have proper defaults
  const safeParams: TransformParams = {
    position: transformParams?.position ?? { x: 0, y: 0 },
    scale: transformParams?.scale ?? { x: 1, y: 1 },
    rotation: transformParams?.rotation ?? 0,
    anchorPoint: transformParams?.anchorPoint ?? { x: 0.5, y: 0.5 },
  };

  // Calculate the bounds after applying the transform
  // newBounds.x/y can be negative if content moves left/up
  const newBounds = calculateTransformedBounds(sourceWidth, sourceHeight, safeParams);

  // Calculate canvas extents that include both origin and transformed content
  const minX = Math.min(0, newBounds.x);
  const minY = Math.min(0, newBounds.y);
  const maxX = Math.max(sourceWidth, newBounds.x + newBounds.width);
  const maxY = Math.max(sourceHeight, newBounds.y + newBounds.height);

  // Canvas dimensions to fit everything
  const canvasWidth = Math.ceil(maxX - minX);
  const canvasHeight = Math.ceil(maxY - minY);

  const newCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = newCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2d context for transform canvas');
  }

  // Clear with transparency
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // The offset to bring content into positive canvas space
  // If minX is -100, we need to shift everything right by 100
  const offsetX = -minX;
  const offsetY = -minY;

  // Apply the transform
  ctx.save();

  // Calculate anchor point in the canvas coordinate system
  // The original (0,0) is now at (offsetX, offsetY) in canvas space
  const anchorX = offsetX + sourceWidth * safeParams.anchorPoint.x;
  const anchorY = offsetY + sourceHeight * safeParams.anchorPoint.y;

  ctx.translate(anchorX + safeParams.position.x, anchorY + safeParams.position.y);
  ctx.rotate((safeParams.rotation * Math.PI) / 180);
  ctx.scale(safeParams.scale.x, safeParams.scale.y);
  ctx.translate(-sourceWidth * safeParams.anchorPoint.x, -sourceHeight * safeParams.anchorPoint.y);

  // Draw the source canvas at the offset position (where original 0,0 now lives)
  ctx.drawImage(sourceCanvas, 0, 0);

  ctx.restore();

  return newCanvas;
}

/**
 * Check if an operation is a transform type (handled via 2D canvas, not GPU)
 */
function isTransformOperation(op: OperationNode): boolean {
  return op.operationType === 'transform';
}

interface UseChainRendererOptions {
  /** Node ID to render */
  nodeId: string;
  /** Whether the node is selected (affects playback updates) */
  selected: boolean;
  /** Canvas ref to render to */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

interface ChainRendererState {
  isLoading: boolean;
  error: string | null;
  hasUpstream: boolean;
  dimensions: { width: number; height: number };
}

/**
 * Hook to render the upstream effect chain for a node
 */
export function useChainRenderer(options: UseChainRendererOptions): ChainRendererState {
  const { nodeId, selected, canvasRef } = options;

  // Refs for GPU resources
  const gpuContextRef = useRef<WebGLContext | null>(null);
  const texturePoolRef = useRef<TexturePool | null>(null);
  const pipelineRef = useRef<RenderPipeline | null>(null);
  const lastRenderedFrameRef = useRef<number | null>(null);
  const lastParamsHashRef = useRef<string | null>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);

  // State - default to 1080x1080 until we know the actual dimensions
  const [state, setState] = useState<ChainRendererState>({
    isLoading: true,
    error: null,
    hasUpstream: false,
    dimensions: { width: DEFAULT_VIEWER_WIDTH, height: DEFAULT_VIEWER_HEIGHT },
  });

  // Stores
  const assets = useAssetStore((s) => s.assets);
  const layers = useLayerStore((s) => s.layers);

  // Optimized frame subscription:
  // - Selected nodes subscribe to currentFrame for real-time updates
  // - Unselected nodes only subscribe to pauseTrigger to update when playback stops
  const pauseTrigger = useTimelineStore((s) => s.pauseTrigger);

  // Only subscribe to currentFrame when selected - this prevents re-renders during playback
  const globalFrame = useTimelineStore((s) => selected ? s.currentFrame : null);

  // Determine the frame to render:
  // - If selected: use globalFrame (real-time updates)
  // - If not selected: use cached frame, updated only when pauseTrigger changes
  const currentFrame = useMemo(() => {
    if (selected && globalFrame !== null) {
      return globalFrame;
    }
    // When not selected, read current frame directly from store on pauseTrigger change
    return useTimelineStore.getState().currentFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, globalFrame, pauseTrigger]);

  // Get the active graph by subscribing to composition
  const activeCompId = useCompositionStore((s) => s.activeCompositionId);
  const composition = useAssetStore((s) => {
    if (!activeCompId) return null;
    const asset = s.assets[activeCompId];
    if (asset && asset.type === 'composition') {
      return asset;
    }
    return null;
  });
  const graph = composition?.graph ?? null;

  // Initialize GPU context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create offscreen canvas for GPU rendering (will be resized as needed)
    const offscreen = new OffscreenCanvas(DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT);
    offscreenCanvasRef.current = offscreen;

    const context = new WebGLContext();
    const initGPU = async () => {
      try {
        await context.init({ canvas: offscreen });
        gpuContextRef.current = context;
        texturePoolRef.current = new TexturePool(context);
        pipelineRef.current = new RenderPipeline(context, texturePoolRef.current);
      } catch (err) {
        console.error('Failed to initialize GPU context:', err);
        setState((s) => ({ ...s, error: 'GPU initialization failed' }));
      }
    };

    initGPU();

    return () => {
      pipelineRef.current?.clearAll();
      texturePoolRef.current?.clearAll();
      gpuContextRef.current?.dispose();
      gpuContextRef.current = null;
      texturePoolRef.current = null;
      pipelineRef.current = null;
    };
  }, [canvasRef]);

  // Render effect
  const render = useCallback(async () => {
    if (!graph || !canvasRef.current) return;

    const sceneGraph: SceneGraph = {
      nodes: graph.nodes,
      edges: graph.edges,
    };

    // Find upstream chain
    const chain = findUpstreamChain(sceneGraph, nodeId);

    if (!chain.isComplete || !chain.sourceNode) {
      setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: false }));
      return;
    }

    setState((s) => ({ ...s, hasUpstream: true }));

    // Get the source layer
    const sourceLayer = layers[chain.sourceNode!.layerId];
    if (!sourceLayer) {
      setState((s) => ({ ...s, isLoading: false, error: 'Source layer not found', hasUpstream: true }));
      return;
    }

    // Get the source asset
    const sourceAsset = assets[sourceLayer.assetId];
    if (!sourceAsset) {
      setState((s) => ({ ...s, isLoading: false, error: 'Source asset not found', hasUpstream: true }));
      return;
    }

    // Update dimensions from source asset
    const assetDimensions = { width: sourceAsset.intrinsicWidth, height: sourceAsset.intrinsicHeight };

    // Only render assets that can be converted to bitmaps (video, image, shape)
    if (!isRenderableAsset(sourceAsset)) {
      setState((s) => ({ ...s, isLoading: false, error: 'Unsupported asset type', hasUpstream: true, dimensions: assetDimensions }));
      return;
    }

    // Check if asset is still loading
    if (sourceAsset.loadingState?.isLoading) {
      setState((s) => ({ ...s, isLoading: true, error: null, hasUpstream: true, dimensions: assetDimensions }));
      return;
    }

    // Map global frame to source frame
    const sourceFrame = mapGlobalFrameToSource(
      currentFrame,
      sourceLayer.timeRange,
      sourceAsset
    );

    // If null, layer is not active at this frame - show checkerboard
    if (sourceFrame === null) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawCheckerboard(ctx, canvas.width, canvas.height);
      }
      lastRenderedFrameRef.current = null;
      setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
      return;
    }

    // Create a hash of effect parameters and layer transform to detect changes
    const transformHash = JSON.stringify(sourceLayer.baseTransform);
    const paramsHash = chain.operationNodes
      .map((op) => `${op.id}:${op.isEnabled}:${JSON.stringify(op.params)}`)
      .join('|') + `|transform:${transformHash}`;

    // Skip if we already rendered this frame AND effect params haven't changed
    if (lastRenderedFrameRef.current === sourceFrame && lastParamsHashRef.current === paramsHash) {
      return;
    }

    try {
      // Load the source frame
      let bitmap = globalFrameCache.get(sourceAsset.id, sourceFrame);
      if (!bitmap) {
        bitmap = await loadAssetFrame(sourceAsset, sourceFrame);
        globalFrameCache.set(sourceAsset.id, sourceFrame, bitmap);
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Get the layer's base transform for applying position/scale/rotation
      const transform = sourceLayer.baseTransform;

      /**
       * Apply baseTransform to the bitmap and return an expanded canvas that fits all content.
       * This prevents clipping when content extends outside the original dimensions.
       *
       * The canvas is sized to include both:
       * - The original layer bounds (0,0 to srcWidth,srcHeight)
       * - The transformed content bounds (may extend beyond original in any direction)
       */
      const applyBaseTransform = (inputBitmap: ImageBitmap): OffscreenCanvas => {
        const srcWidth = inputBitmap.width;
        const srcHeight = inputBitmap.height;

        // Convert baseTransform to TransformParams format for bounds calculation
        const transformParams: TransformParams = {
          position: transform.position,
          scale: transform.scale,
          rotation: transform.rotation,
          anchorPoint: transform.anchorPoint,
        };

        // Calculate the bounds after applying the transform
        // newBounds.x/y can be negative if content moves left/up
        const newBounds = calculateTransformedBounds(srcWidth, srcHeight, transformParams);

        // Calculate canvas extents that include both origin and transformed content
        // minX/minY: leftmost/topmost point (could be 0 or negative transformed coord)
        // maxX/maxY: rightmost/bottommost point (original extent or transformed extent)
        const minX = Math.min(0, newBounds.x);
        const minY = Math.min(0, newBounds.y);
        const maxX = Math.max(srcWidth, newBounds.x + newBounds.width);
        const maxY = Math.max(srcHeight, newBounds.y + newBounds.height);

        // Canvas dimensions to fit everything
        const canvasWidth = Math.ceil(maxX - minX);
        const canvasHeight = Math.ceil(maxY - minY);

        const resultCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
        const ctx = resultCanvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get 2d context for base transform canvas');
        }

        // Clear with transparency
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // The offset to bring content into positive canvas space
        // If minX is -100, we need to shift everything right by 100
        const offsetX = -minX;
        const offsetY = -minY;

        // Apply the transform
        ctx.save();

        // Calculate anchor point in the canvas coordinate system
        // The original (0,0) is now at (offsetX, offsetY) in canvas space
        const anchorX = offsetX + srcWidth * transform.anchorPoint.x;
        const anchorY = offsetY + srcHeight * transform.anchorPoint.y;

        // Move to anchor, apply transforms, move back
        ctx.translate(anchorX + transform.position.x, anchorY + transform.position.y);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.scale.x, transform.scale.y);
        ctx.translate(-srcWidth * transform.anchorPoint.x, -srcHeight * transform.anchorPoint.y);

        // Draw the bitmap
        ctx.drawImage(inputBitmap, 0, 0);

        ctx.restore();

        return resultCanvas;
      };

      /**
       * Legacy helper for drawing directly to display canvas (clipped to canvas size).
       * Used when there are no operations to process.
       */
      const drawTransformedBitmapClipped = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        // Clear with transparency
        ctx.clearRect(0, 0, width, height);

        ctx.save();

        // Apply transform with clipping to canvas bounds
        const anchorX = transform.anchorPoint.x * width;
        const anchorY = transform.anchorPoint.y * height;

        ctx.translate(anchorX + transform.position.x, anchorY + transform.position.y);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.scale.x, transform.scale.y);
        ctx.translate(-anchorX, -anchorY);

        ctx.drawImage(bitmap, 0, 0, width, height);

        ctx.restore();
      };

      // If no operation nodes in chain, just draw directly at full resolution (clipped to layer bounds)
      if (chain.operationNodes.length === 0) {
        // Set canvas to full resolution - CSS handles display scaling
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawTransformedBitmapClipped(ctx, bitmap.width, bitmap.height);
        }
        lastRenderedFrameRef.current = sourceFrame;
        lastParamsHashRef.current = paramsHash;
        setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
        return;
      }

      // Apply effects using GPU pipeline
      const gpuContext = gpuContextRef.current;
      const texturePool = texturePoolRef.current;
      const pipeline = pipelineRef.current;

      if (!gpuContext || !texturePool || !pipeline) {
        // Fallback to 2D canvas without effects - full resolution (clipped to layer bounds)
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawTransformedBitmapClipped(ctx, bitmap.width, bitmap.height);
        }
        lastRenderedFrameRef.current = sourceFrame;
        lastParamsHashRef.current = paramsHash;
        setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
        return;
      }

      // Get enabled operations in chain order
      const enabledOps = chain.operationNodes.filter((op) => op.isEnabled);

      // If all operations are disabled, draw without effects - full resolution (clipped to layer bounds)
      if (enabledOps.length === 0) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawTransformedBitmapClipped(ctx, bitmap.width, bitmap.height);
        }
        lastRenderedFrameRef.current = sourceFrame;
        lastParamsHashRef.current = paramsHash;
        setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
        return;
      }

      // Step 1: Apply baseTransform to create initial transformed canvas
      // This expands the canvas to fit all transformed content (no clipping)
      let currentCanvas: OffscreenCanvas = applyBaseTransform(bitmap);

      // Step 2: Process operations in chain order
      // Group consecutive GPU operations for batch processing
      let i = 0;
      while (i < enabledOps.length) {
        const op = enabledOps[i];

        if (isTransformOperation(op)) {
          // Apply transform operation via 2D canvas
          const params = op.params as TransformParams;
          currentCanvas = await applyTransformOperation(currentCanvas, params);
          i++;
        } else {
          // Collect consecutive GPU operations
          const gpuBatch: OperationNode[] = [];
          while (i < enabledOps.length && !isTransformOperation(enabledOps[i])) {
            gpuBatch.push(enabledOps[i]);
            i++;
          }

          // Process GPU batch
          if (gpuBatch.length > 0) {
            // Build render nodes for this batch
            const renderNodes: RenderNode[] = gpuBatch.map((gpuOp, index) => ({
              id: gpuOp.id,
              effectName: OPERATION_TO_EFFECT[gpuOp.operationType] ?? gpuOp.operationType,
              parameters: gpuOp.params as unknown as Record<string, UniformValue>,
              inputIds: index === 0 ? ['source'] : [gpuBatch[index - 1].id],
            }));

            // Create bitmap from current canvas for GPU upload
            const inputBitmap = await createImageBitmap(currentCanvas);
            const gpuWidth = inputBitmap.width;
            const gpuHeight = inputBitmap.height;

            // Resize offscreen canvas to match dimensions
            const offscreen = offscreenCanvasRef.current;
            if (offscreen) {
              offscreen.width = gpuWidth;
              offscreen.height = gpuHeight;
              gpuContext.resize(gpuWidth, gpuHeight);
            }

            // Upload to GPU
            const sourceTexture = gpuContext.uploadImageBitmap(inputBitmap);
            inputBitmap.close();

            // Evaluate the effect pipeline
            const outputTexture = pipeline.evaluate(renderNodes, sourceTexture, sourceFrame);

            // Read result back
            const pixels = gpuContext.readPixels(outputTexture);
            const clampedPixels = new Uint8ClampedArray(pixels.length);
            clampedPixels.set(pixels);
            const imageData = new ImageData(clampedPixels, gpuWidth, gpuHeight);

            // Update currentCanvas with GPU output
            currentCanvas = new OffscreenCanvas(gpuWidth, gpuHeight);
            const outputCtx = currentCanvas.getContext('2d');
            if (outputCtx) {
              outputCtx.putImageData(imageData, 0, 0);
            }

            // Clean up
            sourceTexture.dispose();
          }
        }
      }

      // Step 3: Draw final result to display canvas
      canvas.width = currentCanvas.width;
      canvas.height = currentCanvas.height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(currentCanvas, 0, 0);
      }

      lastRenderedFrameRef.current = sourceFrame;
      lastParamsHashRef.current = paramsHash;
      setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
    } catch (err) {
      console.error('Failed to render chain:', err);
      setState((s) => ({ ...s, isLoading: false, error: 'Render failed', hasUpstream: true }));
    }
  }, [graph, nodeId, assets, layers, currentFrame, canvasRef]);

  // Run render when dependencies change
  useEffect(() => {
    render();
  }, [render]);

  return state;
}
