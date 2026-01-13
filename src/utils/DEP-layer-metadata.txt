/**
 * Layer Metadata Utilities
 *
 * Computes and caches layer metadata as it propagates through the node graph.
 * Source nodes create layers, effects accumulate on layers, merges create stacks.
 */

import type { Edge } from '@xyflow/react';
import type {
  GraphNode,
  NodeTimeRange,
  VideoNodeData,
  ImageNodeData,
  EffectNodeData,
  MergeNodeData,
  MergeBlendMode,
} from '../types/nodes';
import type {
  LayerMetadata,
  LayerOutput,
  StackedLayer,
  AppliedEffect,
  LayerCacheEntry,
} from '../types/layer-metadata';
import { createLayerFromSource } from '../types/layer-metadata';
import { getNodeTimeRange } from './node-time';

// =============================================================================
// Constants
// =============================================================================

/** Map of effect node types to their GPU effect names */
const EFFECT_TYPE_MAP: Record<string, string> = {
  blur: 'gaussianBlur',
  colorAdjust: 'colorAdjust',
};

/** Effect node types that process layers */
const EFFECT_NODE_TYPES = ['blur', 'colorAdjust'];

// =============================================================================
// Cache
// =============================================================================

/** Cache for computed layer outputs. Key: nodeId */
const layerCache = new Map<string, LayerCacheEntry>();

/**
 * Clear entire layer cache
 */
export function clearLayerCache(): void {
  layerCache.clear();
}

/**
 * Invalidate cache for a node and all downstream nodes
 */
export function invalidateLayerCache(
  nodeId: string,
  _nodes: GraphNode[],
  edges: Edge[]
): void {
  layerCache.delete(nodeId);

  // Find and invalidate downstream
  const downstream = findDownstreamNodeIds(nodeId, edges);
  for (const id of downstream) {
    layerCache.delete(id);
  }
}

/**
 * Find all downstream node IDs from a given node
 */
function findDownstreamNodeIds(nodeId: string, edges: Edge[]): string[] {
  const downstream = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === current && !downstream.has(edge.target)) {
        downstream.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return Array.from(downstream);
}

/**
 * Compute a hash for cache invalidation
 */
function computeInputHash(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[]
): string {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return '';

  // Include node data and incoming edges
  const incomingEdges = edges
    .filter((e) => e.target === nodeId)
    .map((e) => `${e.source}:${e.targetHandle ?? 'default'}`)
    .sort()
    .join(',');

  const nodeDataHash = JSON.stringify(node.data);

  return `${nodeId}|${node.type}|${incomingEdges}|${nodeDataHash}`;
}

// =============================================================================
// Core Computation
// =============================================================================

interface GlobalRange {
  start: number;
  end: number;
}

/**
 * Get layer output for a node (with caching)
 */
export function getLayerOutput(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[],
  globalRange: GlobalRange
): LayerOutput | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const node = nodeMap.get(nodeId);

  if (!node) return null;

  // Check cache
  const inputHash = computeInputHash(nodeId, nodes, edges);
  const cached = layerCache.get(nodeId);
  if (cached && cached.inputHash === inputHash) {
    return cached.output;
  }

  // Compute based on node type
  const output = computeLayerOutput(node, nodeMap, edges, globalRange);

  if (output) {
    layerCache.set(nodeId, {
      output,
      inputHash,
      computedAt: Date.now(),
    });
  }

  return output;
}

/**
 * Compute layer output for a node (recursive)
 */
function computeLayerOutput(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  edges: Edge[],
  globalRange: GlobalRange
): LayerOutput | null {
  const nodeType = node.type ?? '';

  // Source nodes: create initial layer
  if (nodeType === 'video') {
    return computeVideoLayerOutput(node, globalRange);
  }

  if (nodeType === 'image') {
    return computeImageLayerOutput(node, globalRange);
  }

  // Effect nodes: propagate and add effect
  if (EFFECT_NODE_TYPES.includes(nodeType)) {
    return computeEffectLayerOutput(node, nodeMap, edges, globalRange);
  }

  // Merge nodes: combine into stack
  if (nodeType === 'merge') {
    return computeMergeLayerOutput(node, nodeMap, edges, globalRange);
  }

  return null;
}

/**
 * Video source -> single layer
 */
function computeVideoLayerOutput(
  node: GraphNode,
  globalRange: GlobalRange
): LayerOutput | null {
  const data = node.data as VideoNodeData;

  const timeRange = getNodeTimeRange(node, globalRange);
  const dimensions =
    data.format ??
    (data.extractedFrames
      ? {
          width: data.extractedFrames.width,
          height: data.extractedFrames.height,
        }
      : null);

  if (!dimensions) return null;

  return {
    type: 'single',
    layer: createLayerFromSource(node.id, 'video', timeRange, dimensions),
  };
}

/**
 * Image source -> single layer
 */
function computeImageLayerOutput(
  node: GraphNode,
  globalRange: GlobalRange
): LayerOutput | null {
  const data = node.data as ImageNodeData;

  const timeRange = getNodeTimeRange(node, globalRange);
  const dimensions = data.format ?? data.nativeDimensions;

  if (!dimensions) return null;

  return {
    type: 'single',
    layer: createLayerFromSource(node.id, 'image', timeRange, dimensions),
  };
}

/**
 * Effect node -> propagate layer(s) with effect added
 */
function computeEffectLayerOutput(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  edges: Edge[],
  globalRange: GlobalRange
): LayerOutput | null {
  // Find upstream node
  const upstreamEdge = edges.find((e) => e.target === node.id);
  if (!upstreamEdge) return null;

  const upstreamNode = nodeMap.get(upstreamEdge.source);
  if (!upstreamNode) return null;

  // Get upstream output recursively
  const upstreamOutput = computeLayerOutput(
    upstreamNode,
    nodeMap,
    edges,
    globalRange
  );
  if (!upstreamOutput) return null;

  // Create the applied effect
  const effectData = node.data as EffectNodeData;
  const appliedEffect: AppliedEffect = {
    nodeId: node.id,
    config: {
      id: node.id,
      effectName: EFFECT_TYPE_MAP[node.type ?? ''] ?? node.type ?? 'unknown',
      parameters: effectData.parameters as Record<
        string,
        number | number[] | boolean
      >,
      enabled: true,
    },
  };

  // Apply to all layers in the output
  if (upstreamOutput.type === 'single') {
    return {
      type: 'single',
      layer: addEffectToLayer(upstreamOutput.layer, appliedEffect, node.id),
    };
  } else {
    // Apply effect to all layers in stack
    return {
      type: 'stack',
      stack: {
        ...upstreamOutput.stack,
        layers: upstreamOutput.stack.layers.map((sl) => ({
          ...sl,
          layer: addEffectToLayer(sl.layer, appliedEffect, node.id),
        })),
      },
    };
  }
}

/**
 * Add an effect to a layer (immutable)
 */
function addEffectToLayer(
  layer: LayerMetadata,
  effect: AppliedEffect,
  nodeId: string
): LayerMetadata {
  return {
    ...layer,
    effectChain: [...layer.effectChain, effect],
    nodePath: [...layer.nodePath, nodeId],
  };
}

/**
 * Merge node -> combine inputs into stack
 */
function computeMergeLayerOutput(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  edges: Edge[],
  globalRange: GlobalRange
): LayerOutput | null {
  const data = node.data as MergeNodeData;

  // Find bg and fg inputs
  const bgEdge = edges.find(
    (e) => e.target === node.id && e.targetHandle === 'bg'
  );
  const fgEdge = edges.find(
    (e) => e.target === node.id && e.targetHandle === 'fg'
  );

  // Need at least bg for output
  if (!bgEdge) return null;

  const bgNode = nodeMap.get(bgEdge.source);
  if (!bgNode) return null;

  // Get bg output (required)
  const bgOutput = computeLayerOutput(bgNode, nodeMap, edges, globalRange);
  if (!bgOutput) return null;

  // Flatten bg to stacked layers (bottom of stack)
  const bgLayers = flattenToStackedLayers(bgOutput, 'over', 1, 0);

  // Get fg output if connected
  let fgLayers: StackedLayer[] = [];
  if (fgEdge) {
    const fgNode = nodeMap.get(fgEdge.source);
    if (fgNode) {
      const fgOutput = computeLayerOutput(fgNode, nodeMap, edges, globalRange);
      if (fgOutput) {
        fgLayers = flattenToStackedLayers(
          fgOutput,
          data.parameters.blendMode,
          data.parameters.opacity,
          bgLayers.length
        );
      }
    }
  }

  // Combine layers
  const allLayers = [...bgLayers, ...fgLayers];

  // Compute union time range
  const unionTimeRange = computeUnionTimeRange(
    allLayers.map((sl) => sl.layer.timeRange)
  );

  // Output dimensions from bg
  const outputDimensions = bgLayers[0]?.layer.outputDimensions ?? {
    width: 0,
    height: 0,
  };

  return {
    type: 'stack',
    stack: {
      layers: allLayers,
      timeRange: unionTimeRange,
      outputDimensions,
      mergeNodeId: node.id,
    },
  };
}

/**
 * Flatten a layer output to an array of stacked layers
 */
function flattenToStackedLayers(
  output: LayerOutput,
  blendMode: MergeBlendMode,
  opacity: number,
  startIndex: number
): StackedLayer[] {
  if (output.type === 'single') {
    return [
      {
        layer: output.layer,
        blend: { blendMode, opacity, stackIndex: startIndex },
      },
    ];
  } else {
    // Re-index existing stack, top layer gets the merge's blend settings
    return output.stack.layers.map((sl, i) => ({
      ...sl,
      blend: {
        ...sl.blend,
        stackIndex: startIndex + i,
        // Top layer of fg gets the merge node's blend settings
        ...(i === output.stack.layers.length - 1 ? { blendMode, opacity } : {}),
      },
    }));
  }
}

/**
 * Compute union of time ranges (max duration)
 */
function computeUnionTimeRange(ranges: NodeTimeRange[]): NodeTimeRange {
  if (ranges.length === 0) {
    return { inFrame: 0, outFrame: 0 };
  }

  let minIn = Infinity;
  let maxOut = -Infinity;

  for (const range of ranges) {
    minIn = Math.min(minIn, range.inFrame);
    maxOut = Math.max(maxOut, range.outFrame);
  }

  return { inFrame: minIn, outFrame: maxOut };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the effective time range for any node (propagated from source)
 */
export function getEffectiveTimeRange(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[],
  globalRange: GlobalRange
): NodeTimeRange | null {
  const output = getLayerOutput(nodeId, nodes, edges, globalRange);
  if (!output) return null;

  if (output.type === 'single') {
    return output.layer.timeRange;
  } else {
    return output.stack.timeRange;
  }
}

/**
 * Get the effect chain for a specific layer at a node
 */
export function getLayerEffectChain(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[],
  globalRange: GlobalRange,
  layerSourceId?: string
): AppliedEffect[] | null {
  const output = getLayerOutput(nodeId, nodes, edges, globalRange);
  if (!output) return null;

  if (output.type === 'single') {
    return output.layer.effectChain;
  } else {
    // Find specific layer or return first
    const stackedLayer = layerSourceId
      ? output.stack.layers.find((sl) => sl.layer.sourceId === layerSourceId)
      : output.stack.layers[0];
    return stackedLayer?.layer.effectChain ?? null;
  }
}

/**
 * Get all layers at a node (for merge outputs)
 */
export function getLayersAtNode(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[],
  globalRange: GlobalRange
): StackedLayer[] | null {
  const output = getLayerOutput(nodeId, nodes, edges, globalRange);
  if (!output) return null;

  if (output.type === 'single') {
    return [
      {
        layer: output.layer,
        blend: { blendMode: 'over', opacity: 1, stackIndex: 0 },
      },
    ];
  } else {
    return output.stack.layers;
  }
}

/**
 * Get the output dimensions for a node
 */
export function getOutputDimensions(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[],
  globalRange: GlobalRange
): { width: number; height: number } | null {
  const output = getLayerOutput(nodeId, nodes, edges, globalRange);
  if (!output) return null;

  if (output.type === 'single') {
    return output.layer.outputDimensions;
  } else {
    return output.stack.outputDimensions;
  }
}

/**
 * Get the source layer info for a node
 * Returns information about the original source(s) feeding into this node
 */
export function getSourceLayers(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[],
  globalRange: GlobalRange
): LayerMetadata[] | null {
  const output = getLayerOutput(nodeId, nodes, edges, globalRange);
  if (!output) return null;

  if (output.type === 'single') {
    return [output.layer];
  } else {
    return output.stack.layers.map((sl) => sl.layer);
  }
}
