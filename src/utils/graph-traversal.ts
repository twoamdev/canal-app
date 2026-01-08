/**
 * Graph Traversal Utilities
 *
 * Provides functions to traverse the node graph and build render chains.
 */

import type { Edge } from '@xyflow/react';
import type { GraphNode, EffectConfig } from '../types/nodes';

/**
 * Result of traversing upstream from a node
 */
export interface UpstreamChain {
  // The source node (video/image) that provides frames
  sourceNode: GraphNode | null;
  // Ordered list of effect nodes from source to target
  effectNodes: GraphNode[];
  // Effect configs ready for the render pipeline
  effectConfigs: EffectConfig[];
  // Whether the chain is complete (has a source)
  isComplete: boolean;
}

/**
 * Map of effect node types to their GPU effect names
 */
const EFFECT_TYPE_MAP: Record<string, string> = {
  blur: 'gaussianBlur',
  colorAdjust: 'colorAdjust',
};

/**
 * Source node types that provide frames
 */
const SOURCE_NODE_TYPES = ['video', 'image'];

/**
 * Effect node types that process frames
 */
const EFFECT_NODE_TYPES = ['blur', 'colorAdjust'];

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

  // Start from the given node and walk backwards
  let currentNodeId: string | null = nodeId;
  const visited = new Set<string>();

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const currentNode = nodeMap.get(currentNodeId);

    if (!currentNode) break;

    // Check if this is a source node
    if (SOURCE_NODE_TYPES.includes(currentNode.type ?? '')) {
      sourceNode = currentNode;
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

  return {
    sourceNode,
    effectNodes,
    effectConfigs,
    isComplete: sourceNode !== null,
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
    const data = sourceNode.data as { extractedFrames?: { width: number; height: number } };
    if (data.extractedFrames) {
      return {
        width: data.extractedFrames.width,
        height: data.extractedFrames.height,
      };
    }
  }
  // TODO: Handle image nodes
  return null;
}

/**
 * Get the frame info from a source node (for video nodes)
 */
export function getSourceFrameInfo(sourceNode: GraphNode): {
  frameCount: number;
  currentFrameIndex: number;
  format: string;
  opfsPath: string;
} | null {
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
        frameCount: data.extractedFrames.frameCount,
        currentFrameIndex: data.extractedFrames.currentFrameIndex,
        format: data.extractedFrames.format,
        opfsPath: data.file.opfsPath,
      };
    }
  }
  return null;
}
