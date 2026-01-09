/**
 * Graph Traversal Utilities
 *
 * Provides functions to traverse the node graph and build render chains.
 */

import type { Edge } from '@xyflow/react';
import type { GraphNode, EffectConfig, NodeFormat, VideoNodeData, ImageNodeData } from '../types/nodes';

/**
 * Result of traversing upstream from a node
 */
export interface UpstreamChain {
  // The source node (video/image) that provides frames
  sourceNode: GraphNode | null;
  // Composite source node (merge) if the chain terminates at one
  compositeSourceNode: GraphNode | null;
  // Ordered list of effect nodes from source to target
  effectNodes: GraphNode[];
  // Effect configs ready for the render pipeline
  effectConfigs: EffectConfig[];
  // Whether the chain is complete (has a source or composite source)
  isComplete: boolean;
  // Whether the source is a composite (merge) rather than a primary source (video/image)
  hasCompositeSource: boolean;
}

/**
 * Map of effect node types to their GPU effect names
 */
const EFFECT_TYPE_MAP: Record<string, string> = {
  blur: 'gaussianBlur',
  colorAdjust: 'colorAdjust',
  merge: 'merge',
};

/**
 * Source node types that provide frames
 */
const SOURCE_NODE_TYPES = ['video', 'image'];

/**
 * Composite source types (multi-input nodes that produce a single output)
 * These are treated as "sources" for downstream nodes - the chain stops here
 */
const COMPOSITE_SOURCE_TYPES = ['merge'];

/**
 * Effect node types that process frames (single-input pass-through effects)
 */
const EFFECT_NODE_TYPES = ['blur', 'colorAdjust'];

/**
 * Multi-input node types (have more than one input handle)
 */
export const MULTI_INPUT_NODE_TYPES = ['merge'];

/**
 * Find the upstream chain from a given node
 *
 * Traverses backwards through connections to find:
 * 1. The source node (video/image)
 * 2. All effect nodes in between
 *
 * @param nodeId The node to start from
 * @param nodes All nodes in the graph
 * @param edges All edges in the graph
 * @returns The upstream chain
 */
export function findUpstreamChain(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[]
): UpstreamChain {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const effectNodes: GraphNode[] = [];
  let sourceNode: GraphNode | null = null;
  let compositeSourceNode: GraphNode | null = null;

  // Start from the given node and walk backwards
  let currentNodeId: string | null = nodeId;
  const visited = new Set<string>();

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const currentNode = nodeMap.get(currentNodeId);

    if (!currentNode) break;

    // Check if this is a source node (video/image)
    if (SOURCE_NODE_TYPES.includes(currentNode.type ?? '')) {
      sourceNode = currentNode;
      break;
    }

    // Check if this is a composite source (merge) - treat as terminal
    if (COMPOSITE_SOURCE_TYPES.includes(currentNode.type ?? '')) {
      compositeSourceNode = currentNode;
      break;
    }

    // Check if this is an effect node
    if (EFFECT_NODE_TYPES.includes(currentNode.type ?? '')) {
      // Add to front (we're walking backwards)
      effectNodes.unshift(currentNode);
    }

    // Find the incoming edge (edge where target is this node)
    const incomingEdge = edges.find((e) => e.target === currentNodeId);
    currentNodeId = incomingEdge?.source ?? null;
  }

  // Build effect configs from effect nodes
  const effectConfigs: EffectConfig[] = effectNodes.map((node) => {
    const effectName = EFFECT_TYPE_MAP[node.type ?? ''] ?? node.type ?? 'unknown';
    const parameters = (node.data as { parameters?: Record<string, unknown> }).parameters ?? {};

    return {
      id: node.id,
      effectName,
      parameters: parameters as Record<string, number | number[] | boolean>,
      enabled: true,
    };
  });

  const hasCompositeSource = compositeSourceNode !== null;

  return {
    sourceNode,
    compositeSourceNode,
    effectNodes,
    effectConfigs,
    isComplete: sourceNode !== null || compositeSourceNode !== null,
    hasCompositeSource,
  };
}

/**
 * Find all downstream nodes from a given node
 *
 * @param nodeId The node to start from
 * @param nodes All nodes in the graph
 * @param edges All edges in the graph
 * @returns Array of downstream node IDs
 */
export function findDownstreamNodes(
  nodeId: string,
  _nodes: GraphNode[],
  edges: Edge[]
): string[] {
  const downstream: Set<string> = new Set();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    // Find all edges where this node is the source
    const outgoingEdges = edges.filter((e) => e.source === currentId);

    for (const edge of outgoingEdges) {
      if (!downstream.has(edge.target)) {
        downstream.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return Array.from(downstream);
}

/**
 * Check if a node is a source node (provides frames)
 */
export function isSourceNode(node: GraphNode): boolean {
  return SOURCE_NODE_TYPES.includes(node.type ?? '');
}

/**
 * Check if a node is an effect node (processes frames)
 */
export function isEffectNode(node: GraphNode): boolean {
  return EFFECT_NODE_TYPES.includes(node.type ?? '');
}

/**
 * Get the frame dimensions from a source node
 */
export function getSourceDimensions(
  sourceNode: GraphNode
): { width: number; height: number } | null {
  if (sourceNode.type === 'video') {
    const data = sourceNode.data as VideoNodeData;
    // Use explicit format if set, otherwise use native dimensions from extractedFrames
    if (data.format) {
      return { width: data.format.width, height: data.format.height };
    }
    if (data.extractedFrames) {
      return {
        width: data.extractedFrames.width,
        height: data.extractedFrames.height,
      };
    }
  }

  if (sourceNode.type === 'image') {
    const data = sourceNode.data as ImageNodeData;
    // Use explicit format if set, otherwise use native dimensions
    if (data.format) {
      return { width: data.format.width, height: data.format.height };
    }
    if (data.nativeDimensions) {
      return {
        width: data.nativeDimensions.width,
        height: data.nativeDimensions.height,
      };
    }
  }

  return null;
}

/**
 * Get the effective format (dimensions) for a node
 *
 * - For source nodes (video/image): returns explicit format or native dimensions
 * - For effect nodes: returns null (use getUpstreamFormat instead)
 */
export function getNodeFormat(node: GraphNode): NodeFormat | null {
  if (node.type === 'video') {
    const data = node.data as VideoNodeData;
    if (data.format) return data.format;
    if (data.extractedFrames) {
      return {
        width: data.extractedFrames.width,
        height: data.extractedFrames.height,
      };
    }
    return null;
  }

  if (node.type === 'image') {
    const data = node.data as ImageNodeData;
    if (data.format) return data.format;
    if (data.nativeDimensions) return data.nativeDimensions;
    return null;
  }

  // Effect nodes don't have their own format
  return null;
}

/**
 * Get the format from upstream source (for effect nodes)
 *
 * Traverses upstream to find the source node's format
 */
export function getUpstreamFormat(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[]
): NodeFormat | null {
  const chain = findUpstreamChain(nodeId, nodes, edges);
  if (chain.sourceNode) {
    return getNodeFormat(chain.sourceNode);
  }
  return null;
}

/**
 * Source info for rendering - works for both video and image nodes
 */
export interface SourceInfo {
  sourceType: 'video' | 'image';
  frameCount: number;
  currentFrameIndex: number;
  format: string;
  opfsPath: string;
}

/**
 * Get the source info from a source node (video or image)
 */
export function getSourceFrameInfo(sourceNode: GraphNode): SourceInfo | null {
  if (sourceNode.type === 'video') {
    const data = sourceNode.data as {
      extractedFrames?: {
        frameCount: number;
        currentFrameIndex: number;
        format: string;
      };
      file?: { opfsPath: string };
    };

    if (data.extractedFrames && data.file?.opfsPath) {
      return {
        sourceType: 'video',
        frameCount: data.extractedFrames.frameCount,
        currentFrameIndex: data.extractedFrames.currentFrameIndex,
        format: data.extractedFrames.format,
        opfsPath: data.file.opfsPath,
      };
    }
  }

  if (sourceNode.type === 'image') {
    const data = sourceNode.data as {
      file?: { opfsPath: string; type: string };
    };

    if (data.file?.opfsPath) {
      // Images are a single "frame" that's always active
      const format = data.file.type.split('/')[1] || 'png';
      return {
        sourceType: 'image',
        frameCount: 1,
        currentFrameIndex: 0,
        format,
        opfsPath: data.file.opfsPath,
      };
    }
  }

  return null;
}

// =============================================================================
// Multi-Input Node Support
// =============================================================================

/**
 * Result for nodes with multiple inputs
 */
export interface MultiInputUpstreamChains {
  // Map of handle ID to upstream chain
  chains: Map<string, UpstreamChain>;
  // The node itself
  node: GraphNode | null;
  // Whether all required inputs are connected
  isComplete: boolean;
}

/**
 * Find upstream chains for a multi-input node
 *
 * For merge nodes, this finds both the 'bg' and 'fg' input chains.
 *
 * @param nodeId The multi-input node to find chains for
 * @param nodes All nodes in the graph
 * @param edges All edges in the graph
 * @returns Map of handle IDs to their upstream chains
 */
export function findMultiInputUpstreamChains(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[]
): MultiInputUpstreamChains {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const node = nodeMap.get(nodeId) ?? null;

  if (!node) {
    return { chains: new Map(), node: null, isComplete: false };
  }

  const chains = new Map<string, UpstreamChain>();

  // Find all edges targeting this node, grouped by targetHandle
  const incomingEdges = edges.filter((e) => e.target === nodeId);

  for (const edge of incomingEdges) {
    const handleId = edge.targetHandle ?? 'default';
    // Recursively find upstream chain from the source node
    const chain = findUpstreamChain(edge.source, nodes, edges);
    chains.set(handleId, chain);
  }

  // For merge nodes, both 'bg' and 'fg' are required
  let isComplete = false;
  if (node.type === 'merge') {
    const bgChain = chains.get('bg');
    const fgChain = chains.get('fg');
    isComplete = !!(bgChain?.isComplete && fgChain?.isComplete);
  } else {
    // For other multi-input nodes, at least one complete chain is required
    isComplete = Array.from(chains.values()).some((chain) => chain.isComplete);
  }

  return { chains, node, isComplete };
}

/**
 * Get dimensions for a merge node (uses bg input dimensions)
 *
 * @param nodeId The merge node ID
 * @param nodes All nodes in the graph
 * @param edges All edges in the graph
 * @returns The output dimensions (from bg input) or null
 */
export function getMergeOutputDimensions(
  nodeId: string,
  nodes: GraphNode[],
  edges: Edge[]
): { width: number; height: number } | null {
  const { chains } = findMultiInputUpstreamChains(nodeId, nodes, edges);
  const bgChain = chains.get('bg');

  if (bgChain?.sourceNode) {
    return getSourceDimensions(bgChain.sourceNode);
  }
  return null;
}

/**
 * Check if a node is a multi-input node
 */
export function isMultiInputNode(node: GraphNode): boolean {
  return MULTI_INPUT_NODE_TYPES.includes(node.type ?? '');
}
