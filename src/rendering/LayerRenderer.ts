/**
 * LayerRenderer
 *
 * Renders a single layer through its effect chain.
 * Handles loading assets, applying transforms, and executing effects.
 */

import type { Layer } from '../types/scene-graph';
import type { Asset } from '../types/assets';
import { getAssetDimensions } from '../types/assets';
import { loadAssetAsBitmap, mapGlobalFrameToSource } from '../utils/asset-loader';
import { RenderPipeline, type RenderNode } from '../gpu/RenderPipeline';
import { WebGLContext } from '../gpu/WebGLContext';
import { TexturePool } from '../gpu/TexturePool';
import type { GPUTexture } from '../gpu/types';
import type { SceneNode, OperationNode, Connection, OperationType } from '../types/scene-graph';
import { isOperationNode } from '../types/scene-graph';

// Import effects to register them
import '../gpu/effects/ColorAdjustEffect';
import '../gpu/effects/GaussianBlurEffect';

// =============================================================================
// Types
// =============================================================================

export interface LayerRenderContext {
  /** WebGL context */
  glContext: WebGLContext;
  /** Texture pool for allocation */
  texturePool: TexturePool;
  /** Render pipeline for effect chains */
  pipeline: RenderPipeline;
  /** Hidden WebGL canvas */
  glCanvas: HTMLCanvasElement;
}

export interface LayerRenderResult {
  /** Output texture from GPU rendering */
  texture: GPUTexture | null;
  /** Output as ImageBitmap (for composite sources) */
  bitmap: ImageBitmap | null;
  /** Output dimensions */
  dimensions: { width: number; height: number };
  /** Frame index that was rendered */
  frameIndex: number;
}

// Map operation types to effect names
const OPERATION_TO_EFFECT_MAP: Record<OperationType, string> = {
  blur: 'gaussianBlur',
  color_correct: 'colorAdjust',
  transform: 'transform',
};

// =============================================================================
// LayerRenderer Class
// =============================================================================

export class LayerRenderer {
  private glContext: WebGLContext | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  private texturePool: TexturePool | null = null;
  private pipeline: RenderPipeline | null = null;
  private sourceTexture: GPUTexture | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  // Frame cache
  private frameCache = new Map<string, ImageBitmap>();
  private maxCacheSize = 50;

  constructor() {}

  /**
   * Initialize GPU resources
   */
  async init(dimensions: { width: number; height: number }): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Create hidden canvas for WebGL
        this.glCanvas = document.createElement('canvas');
        this.glCanvas.width = dimensions.width;
        this.glCanvas.height = dimensions.height;

        // Initialize WebGL context
        this.glContext = new WebGLContext();
        await this.glContext.init({
          canvas: this.glCanvas,
          preserveDrawingBuffer: true,
        });

        // Create texture pool
        this.texturePool = new TexturePool(this.glContext, {
          maxTextures: 32,
          maxMemoryBytes: 256 * 1024 * 1024,
        });

        // Create render pipeline
        this.pipeline = new RenderPipeline(this.glContext, this.texturePool);

        this.isInitialized = true;
        console.log('[LayerRenderer] Initialized with dimensions:', dimensions);
      } catch (err) {
        console.error('[LayerRenderer] Init error:', err);
        this.isInitialized = false;
        throw err;
      }
    })();

    return this.initPromise;
  }

  /**
   * Render a layer at a specific frame
   */
  async renderLayer(
    layer: Layer,
    asset: Asset,
    globalFrame: number,
    operationNodes: OperationNode[],
    targetCanvas?: HTMLCanvasElement
  ): Promise<LayerRenderResult> {
    // Map global frame to source frame
    const sourceFrame = mapGlobalFrameToSource(globalFrame, layer.timeRange, asset);

    // If layer is not active at this frame, return null result
    if (sourceFrame === null) {
      return {
        texture: null,
        bitmap: null,
        dimensions: getAssetDimensions(asset),
        frameIndex: globalFrame,
      };
    }

    // Load the source frame
    let bitmap: ImageBitmap;
    const cacheKey = `${asset.id}:${sourceFrame}`;

    if (this.frameCache.has(cacheKey)) {
      bitmap = this.frameCache.get(cacheKey)!;
    } else {
      bitmap = await loadAssetAsBitmap(asset, sourceFrame);
      this.addToCache(cacheKey, bitmap);
    }

    const dimensions = { width: bitmap.width, height: bitmap.height };

    // If no effects, just draw directly
    if (operationNodes.length === 0 || operationNodes.every((n) => !n.isEnabled)) {
      if (targetCanvas) {
        targetCanvas.width = dimensions.width;
        targetCanvas.height = dimensions.height;
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
        }
      }

      return {
        texture: null,
        bitmap,
        dimensions,
        frameIndex: sourceFrame,
      };
    }

    // Initialize GPU if needed
    if (!this.isInitialized) {
      await this.init(dimensions);
    }

    // Ensure canvas dimensions match
    if (this.glCanvas && (this.glCanvas.width !== dimensions.width || this.glCanvas.height !== dimensions.height)) {
      this.glCanvas.width = dimensions.width;
      this.glCanvas.height = dimensions.height;
    }

    // Ensure source texture matches dimensions
    if (this.sourceTexture) {
      if (this.sourceTexture.width !== dimensions.width || this.sourceTexture.height !== dimensions.height) {
        this.texturePool?.release(this.sourceTexture);
        this.sourceTexture = null;
      }
    }

    if (!this.sourceTexture && this.texturePool) {
      this.sourceTexture = this.texturePool.acquire(dimensions.width, dimensions.height, 'rgba8');
    }

    if (!this.glContext || !this.pipeline || !this.sourceTexture || !this.glCanvas) {
      // Fallback to direct draw
      if (targetCanvas) {
        targetCanvas.width = dimensions.width;
        targetCanvas.height = dimensions.height;
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
        }
      }

      return {
        texture: null,
        bitmap,
        dimensions,
        frameIndex: sourceFrame,
      };
    }

    try {
      // Upload frame to GPU
      this.glContext.uploadImageBitmap(bitmap, this.sourceTexture);

      // Build render nodes from operation nodes
      const renderNodes: RenderNode[] = operationNodes
        .filter((n) => n.isEnabled)
        .map((node, index, arr) => ({
          id: node.id,
          effectName: OPERATION_TO_EFFECT_MAP[node.operationType],
          parameters: node.params as unknown as Record<string, number | number[]>,
          inputIds: index === 0 ? ['source'] : [arr[index - 1].id],
        }));

      // Evaluate pipeline
      const result = this.pipeline.evaluate(renderNodes, this.sourceTexture, sourceFrame);

      // Blit to WebGL canvas
      this.glContext.resize(dimensions.width, dimensions.height);
      this.glContext.blitToCanvas(result);

      // Transfer to target canvas if provided (with Y flip)
      if (targetCanvas) {
        targetCanvas.width = dimensions.width;
        targetCanvas.height = dimensions.height;
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(1, -1);
          ctx.drawImage(this.glCanvas, 0, -targetCanvas.height, targetCanvas.width, targetCanvas.height);
          ctx.restore();
        }
      }

      // Create output bitmap
      const outputBitmap = await createImageBitmap(targetCanvas ?? this.glCanvas);

      return {
        texture: result,
        bitmap: outputBitmap,
        dimensions,
        frameIndex: sourceFrame,
      };
    } catch (err) {
      console.error('[LayerRenderer] Render error:', err);

      // Fallback
      if (targetCanvas) {
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
        }
      }

      return {
        texture: null,
        bitmap,
        dimensions,
        frameIndex: sourceFrame,
      };
    }
  }

  /**
   * Get connected operation nodes for a source node
   */
  getConnectedOperations(
    sourceNodeId: string,
    graph: { nodes: Record<string, SceneNode>; edges: Connection[] }
  ): OperationNode[] {
    const operations: OperationNode[] = [];
    let currentNodeId = sourceNodeId;

    while (true) {
      // Find edge from current node
      const edge = graph.edges.find((e) => e.source === currentNodeId);
      if (!edge) break;

      // Get target node
      const targetNode = graph.nodes[edge.target];
      if (!targetNode || !isOperationNode(targetNode)) break;

      operations.push(targetNode);
      currentNodeId = targetNode.id;
    }

    return operations;
  }

  /**
   * Add frame to cache with LRU eviction
   */
  private addToCache(key: string, bitmap: ImageBitmap): void {
    // Evict oldest if at capacity
    while (this.frameCache.size >= this.maxCacheSize) {
      const firstKey = this.frameCache.keys().next().value;
      if (firstKey) {
        this.frameCache.get(firstKey)?.close();
        this.frameCache.delete(firstKey);
      }
    }

    this.frameCache.set(key, bitmap);
  }

  /**
   * Clear frame cache
   */
  clearCache(): void {
    this.frameCache.forEach((bitmap) => bitmap.close());
    this.frameCache.clear();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clearCache();

    if (this.sourceTexture && this.texturePool) {
      this.texturePool.release(this.sourceTexture);
      this.sourceTexture = null;
    }

    if (this.pipeline) {
      this.pipeline.clearAll();
      this.pipeline = null;
    }

    if (this.texturePool) {
      this.texturePool.clearAll();
      this.texturePool = null;
    }

    if (this.glContext) {
      this.glContext.dispose();
      this.glContext = null;
    }

    this.glCanvas = null;
    this.isInitialized = false;
    this.initPromise = null;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new LayerRenderer instance
 */
export function createLayerRenderer(): LayerRenderer {
  return new LayerRenderer();
}
