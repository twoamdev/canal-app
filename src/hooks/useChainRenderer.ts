/**
 * useChainRenderer Hook
 *
 * Renders the upstream effect chain for a node, displaying the result
 * on a canvas. Used by both SourceNode (no effects) and OperationNode
 * (with effects applied).
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useAssetStore } from '../stores/assetStore';
import { useCompositionStore } from '../stores/compositionStore';
import { useTimelineStore } from '../stores/timelineStore';
import { loadAssetFrame, mapGlobalFrameToSource, globalFrameCache } from '../utils/asset-loader';
import { findUpstreamChain, type SceneGraph } from '../utils/scene-graph-utils';
import { isVideoAsset, isImageAsset } from '../types/assets';
import { WebGLContext } from '../gpu/WebGLContext';
import { TexturePool } from '../gpu/TexturePool';
import { RenderPipeline, type RenderNode } from '../gpu/RenderPipeline';
// Import effects to ensure they are registered
import '../gpu/effects';
import type { OperationType } from '../types/scene-graph';
import type { UniformValue } from '../gpu/types';
import { DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT, drawCheckerboard } from '../components/viewers';

// Map operation types to GPU effect names
const OPERATION_TO_EFFECT: Record<OperationType, string> = {
  blur: 'gaussianBlur',
  color_correct: 'colorAdjust',
  transform: 'transform',
};

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
  const globalFrame = useTimelineStore((s) => s.currentFrame);
  const isPlaying = useTimelineStore((s) => s.isPlaying);

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

  // Only update current frame when selected OR not playing
  const currentFrame = (selected || !isPlaying) ? globalFrame : (lastRenderedFrameRef.current ?? 0);

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

    // Get the source asset
    const sourceAsset = assets[chain.sourceNode.layer.assetId];
    if (!sourceAsset) {
      setState((s) => ({ ...s, isLoading: false, error: 'Source asset not found', hasUpstream: true }));
      return;
    }

    // Update dimensions from source asset
    const assetDimensions = { width: sourceAsset.intrinsicWidth, height: sourceAsset.intrinsicHeight };

    // Only render video/image assets
    if (!isVideoAsset(sourceAsset) && !isImageAsset(sourceAsset)) {
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
      chain.sourceNode.layer.timeRange,
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

    // Create a hash of effect parameters to detect changes
    const paramsHash = chain.operationNodes
      .map((op) => `${op.id}:${op.isEnabled}:${JSON.stringify(op.params)}`)
      .join('|');

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

      // If no operation nodes in chain, just draw directly at full resolution
      if (chain.operationNodes.length === 0) {
        // Set canvas to full resolution - CSS handles display scaling
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
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
        // Fallback to 2D canvas without effects - full resolution
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
        }
        lastRenderedFrameRef.current = sourceFrame;
        lastParamsHashRef.current = paramsHash;
        setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
        return;
      }

      // Build render nodes from operation chain
      const enabledOps = chain.operationNodes.filter((op) => op.isEnabled);
      const renderNodes: RenderNode[] = enabledOps.map((op, index) => ({
        id: op.id,
        effectName: OPERATION_TO_EFFECT[op.operationType] ?? op.operationType,
        parameters: op.params as unknown as Record<string, UniformValue>,
        inputIds: index === 0 ? ['source'] : [enabledOps[index - 1].id],
      }));

      // If all operations are disabled, draw without effects - full resolution
      if (renderNodes.length === 0) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
        }
        lastRenderedFrameRef.current = sourceFrame;
        lastParamsHashRef.current = paramsHash;
        setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
        return;
      }

      // Resize offscreen canvas
      const offscreen = offscreenCanvasRef.current;
      if (offscreen) {
        offscreen.width = bitmap.width;
        offscreen.height = bitmap.height;
        gpuContext.resize(bitmap.width, bitmap.height);
      }

      // Upload source frame to GPU
      const sourceTexture = gpuContext.uploadImageBitmap(bitmap);

      // Evaluate the effect pipeline
      const outputTexture = pipeline.evaluate(renderNodes, sourceTexture, sourceFrame);

      // Read result back and draw to canvas at full resolution
      const pixels = gpuContext.readPixels(outputTexture);
      // Copy to a new Uint8ClampedArray to ensure proper buffer type
      const clampedPixels = new Uint8ClampedArray(pixels.length);
      clampedPixels.set(pixels);
      const imageData = new ImageData(clampedPixels, bitmap.width, bitmap.height);

      // Set canvas to full resolution - CSS handles display scaling
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(imageData, 0, 0);
      }

      // Clean up source texture
      sourceTexture.dispose();

      lastRenderedFrameRef.current = sourceFrame;
      lastParamsHashRef.current = paramsHash;
      setState((s) => ({ ...s, isLoading: false, error: null, hasUpstream: true, dimensions: assetDimensions }));
    } catch (err) {
      console.error('Failed to render chain:', err);
      setState((s) => ({ ...s, isLoading: false, error: 'Render failed', hasUpstream: true }));
    }
  }, [graph, nodeId, assets, currentFrame, canvasRef]);

  // Run render when dependencies change
  useEffect(() => {
    render();
  }, [render]);

  return state;
}
