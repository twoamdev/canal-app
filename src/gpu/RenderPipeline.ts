/**
 * Render Pipeline
 *
 * Manages the execution of effect chains with dirty tracking and caching.
 * Prevents unnecessary re-rendering by tracking what has changed.
 */

import type { GPUContext } from './GPUContext';
import type { GPUTexture, UniformValue } from './types';
import type { Effect } from './effects/Effect';
import { effectRegistry } from './effects/registry';
import { TexturePool } from './TexturePool';

// =============================================================================
// Types
// =============================================================================

export interface RenderNode {
  id: string;
  effectName: string;
  parameters: Record<string, UniformValue>;
  inputIds: string[];  // IDs of upstream nodes (or 'source' for input texture)
}

interface CachedNode {
  node: RenderNode;
  effect: Effect;
  outputTexture: GPUTexture | null;
  parameterHash: string;
  lastFrameIndex: number;
  isDirty: boolean;
}

// Map of effect instances per pipeline (context-local)
// Key is effectName, value is compiled Effect instance for this context

export interface PipelineStats {
  nodesEvaluated: number;
  nodesCached: number;
  renderTime: number;
}

// =============================================================================
// Render Pipeline
// =============================================================================

export class RenderPipeline {
  private context: GPUContext;
  private texturePool: TexturePool;
  private cache: Map<string, CachedNode> = new Map();
  private effectCache: Map<string, Effect> = new Map(); // Context-local effect instances
  private lastStats: PipelineStats = {
    nodesEvaluated: 0,
    nodesCached: 0,
    renderTime: 0,
  };

  constructor(context: GPUContext, texturePool: TexturePool) {
    this.context = context;
    this.texturePool = texturePool;
  }

  /**
   * Get or create an effect instance for this pipeline's context
   * Unlike the global registry, these are context-local
   */
  private getEffect(effectName: string): Effect {
    let effect = this.effectCache.get(effectName);
    if (!effect) {
      effect = effectRegistry.create(effectName);
      effect.compile(this.context);
      this.effectCache.set(effectName, effect);
    }
    return effect;
  }

  /**
   * Evaluate a render graph for a specific frame
   * @param nodes The render nodes in the graph
   * @param sourceTexture The input texture (e.g., video frame)
   * @param frameIndex Current frame index (for cache invalidation)
   * @returns The final output texture
   */
  evaluate(
    nodes: RenderNode[],
    sourceTexture: GPUTexture,
    frameIndex: number
  ): GPUTexture {
    const startTime = performance.now();
    let nodesEvaluated = 0;
    let nodesCached = 0;

    // Build execution order (topological sort)
    const executionOrder = this.topologicalSort(nodes);

    // Track outputs for this evaluation
    const outputs: Map<string, GPUTexture> = new Map();
    outputs.set('source', sourceTexture);

    // Evaluate each node in order
    for (const node of executionOrder) {
      let cached = this.cache.get(node.id);

      // Create cache entry if needed
      if (!cached) {
        // Use context-local effect instance (not global registry cache)
        const effect = this.getEffect(node.effectName);
        cached = {
          node,
          effect,
          outputTexture: null,
          parameterHash: '',
          lastFrameIndex: -1,
          isDirty: true,
        };
        this.cache.set(node.id, cached);
      }

      // Check if we need to re-render
      const parameterHash = this.hashParameters(node.parameters);
      const frameChanged = cached.lastFrameIndex !== frameIndex;
      const paramsChanged = cached.parameterHash !== parameterHash;
      const inputsChanged = this.checkInputsChanged(node, outputs, cached);

      const needsRender =
        cached.isDirty ||
        frameChanged ||
        paramsChanged ||
        inputsChanged ||
        !cached.outputTexture;

      if (needsRender) {
        // Gather input textures
        const inputs: GPUTexture[] = [];
        for (const inputId of node.inputIds) {
          const inputTexture = outputs.get(inputId);
          if (!inputTexture) {
            throw new Error(
              `Input "${inputId}" not found for node "${node.id}"`
            );
          }
          inputs.push(inputTexture);
        }

        // Acquire output texture if needed
        if (
          !cached.outputTexture ||
          cached.outputTexture.width !== sourceTexture.width ||
          cached.outputTexture.height !== sourceTexture.height
        ) {
          if (cached.outputTexture) {
            this.texturePool.release(cached.outputTexture);
          }
          cached.outputTexture = this.texturePool.acquire(
            sourceTexture.width,
            sourceTexture.height,
            sourceTexture.format
          );
        }

        // Update effect parameters
        cached.effect.setParameters(node.parameters);

        // Apply effect
        cached.effect.apply(this.context, inputs, cached.outputTexture);

        // Update cache state
        cached.parameterHash = parameterHash;
        cached.lastFrameIndex = frameIndex;
        cached.isDirty = false;
        cached.node = node;

        nodesEvaluated++;
      } else {
        nodesCached++;
      }

      // Store output for downstream nodes
      outputs.set(node.id, cached.outputTexture!);
    }

    // Update stats
    this.lastStats = {
      nodesEvaluated,
      nodesCached,
      renderTime: performance.now() - startTime,
    };

    // Return final output (last node's output, or source if no nodes)
    if (executionOrder.length === 0) {
      return sourceTexture;
    }

    const lastNode = executionOrder[executionOrder.length - 1];
    return outputs.get(lastNode.id) ?? sourceTexture;
  }

  /**
   * Mark a node as dirty (needs re-render)
   * Also marks all downstream nodes as dirty
   */
  markDirty(nodeId: string, nodes: RenderNode[]): void {
    const cached = this.cache.get(nodeId);
    if (cached) {
      cached.isDirty = true;
    }

    // Mark downstream nodes
    const downstream = this.findDownstreamNodes(nodeId, nodes);
    for (const id of downstream) {
      const downstreamCached = this.cache.get(id);
      if (downstreamCached) {
        downstreamCached.isDirty = true;
      }
    }
  }

  /**
   * Mark all nodes as dirty (e.g., when source frame changes)
   */
  markAllDirty(): void {
    for (const cached of this.cache.values()) {
      cached.isDirty = true;
    }
  }

  /**
   * Clear cached outputs for a specific node
   */
  clearNode(nodeId: string): void {
    const cached = this.cache.get(nodeId);
    if (cached) {
      if (cached.outputTexture) {
        this.texturePool.release(cached.outputTexture);
        cached.outputTexture = null;
      }
      this.cache.delete(nodeId);
    }
  }

  /**
   * Clear all cached outputs
   */
  clearAll(): void {
    for (const cached of this.cache.values()) {
      if (cached.outputTexture) {
        this.texturePool.release(cached.outputTexture);
      }
    }
    this.cache.clear();

    // Dispose of context-local effect instances
    for (const effect of this.effectCache.values()) {
      effect.dispose(this.context);
    }
    this.effectCache.clear();
  }

  /**
   * Get statistics from the last evaluation
   */
  getStats(): PipelineStats {
    return { ...this.lastStats };
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Topological sort of render nodes (Kahn's algorithm)
   */
  private topologicalSort(nodes: RenderNode[]): RenderNode[] {
    const nodeMap = new Map<string, RenderNode>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Build graph
    for (const node of nodes) {
      nodeMap.set(node.id, node);
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    // Calculate in-degrees
    for (const node of nodes) {
      for (const inputId of node.inputIds) {
        if (inputId !== 'source' && nodeMap.has(inputId)) {
          adjacency.get(inputId)!.push(node.id);
          inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
        }
      }
    }

    // Find nodes with no dependencies
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    // Process queue
    const result: RenderNode[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(nodeMap.get(id)!);

      for (const downstream of adjacency.get(id) ?? []) {
        const newDegree = (inDegree.get(downstream) ?? 1) - 1;
        inDegree.set(downstream, newDegree);
        if (newDegree === 0) {
          queue.push(downstream);
        }
      }
    }

    // Check for cycles
    if (result.length !== nodes.length) {
      console.warn('Cycle detected in render graph, some nodes skipped');
    }

    return result;
  }

  /**
   * Find all nodes downstream from a given node
   */
  private findDownstreamNodes(nodeId: string, nodes: RenderNode[]): string[] {
    const downstream: Set<string> = new Set();
    const queue: string[] = [nodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      for (const node of nodes) {
        if (node.inputIds.includes(currentId) && !downstream.has(node.id)) {
          downstream.add(node.id);
          queue.push(node.id);
        }
      }
    }

    return Array.from(downstream);
  }

  /**
   * Check if any inputs have changed since last render
   */
  private checkInputsChanged(
    node: RenderNode,
    _outputs: Map<string, GPUTexture>,
    cached: CachedNode
  ): boolean {
    // If any input is from a node that was just re-rendered, we need to re-render
    for (const inputId of node.inputIds) {
      if (inputId === 'source') continue;

      const inputCached = this.cache.get(inputId);
      if (inputCached && inputCached.lastFrameIndex > cached.lastFrameIndex) {
        return true;
      }
    }
    return false;
  }

  /**
   * Generate a hash of parameter values for cache comparison
   */
  private hashParameters(params: Record<string, UniformValue>): string {
    const entries = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`);
    return entries.join('|');
  }
}
