/**
 * Scene Graph Utilities
 *
 * Utility functions for traversing and manipulating the scene graph.
 */

import type {
  SceneNode,
  SourceNode,
  OperationNode,
  GroupNode,
  Connection,
  OperationType,
  Layer,
} from '../types/scene-graph';
import { isSourceNode, isOperationNode, isGroupNode } from '../types/scene-graph';
import { useLayerStore } from '../stores/layerStore';

// =============================================================================
// Types
// =============================================================================

export interface SceneGraph {
  nodes: Record<string, SceneNode>;
  edges: Connection[];
}

export interface UpstreamChain {
  /** The source node at the start of the chain (or null if incomplete) */
  sourceNode: SourceNode | null;
  /** The group node at the start of the chain (or null if incomplete or if source is a SourceNode) */
  groupNode: GroupNode | null;
  /** Operation nodes in order from source to target */
  operationNodes: OperationNode[];
  /** Whether the chain is complete (has a source or group) */
  isComplete: boolean;
}

export interface EffectConfig {
  id: string;
  effectName: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

// =============================================================================
// Node Queries
// =============================================================================

/**
 * Get all source nodes in a graph
 */
export function getSourceNodes(graph: SceneGraph): SourceNode[] {
  return Object.values(graph.nodes).filter(isSourceNode);
}

/**
 * Get all operation nodes in a graph
 */
export function getOperationNodes(graph: SceneGraph): OperationNode[] {
  return Object.values(graph.nodes).filter(isOperationNode);
}

/**
 * Get a node by ID
 */
export function getNode(graph: SceneGraph, nodeId: string): SceneNode | undefined {
  return graph.nodes[nodeId];
}

/**
 * Get a source node by ID
 */
export function getSourceNode(
  graph: SceneGraph,
  nodeId: string
): SourceNode | undefined {
  const node = graph.nodes[nodeId];
  return node && isSourceNode(node) ? node : undefined;
}

/**
 * Get an operation node by ID
 */
export function getOperationNode(
  graph: SceneGraph,
  nodeId: string
): OperationNode | undefined {
  const node = graph.nodes[nodeId];
  return node && isOperationNode(node) ? node : undefined;
}

// =============================================================================
// Edge Queries
// =============================================================================

/**
 * Find edges going into a node
 */
export function getIncomingEdges(graph: SceneGraph, nodeId: string): Connection[] {
  return graph.edges.filter((edge) => edge.target === nodeId);
}

/**
 * Find edges coming out of a node
 */
export function getOutgoingEdges(graph: SceneGraph, nodeId: string): Connection[] {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

/**
 * Find the upstream node connected to a target node's input
 */
export function getUpstreamNode(
  graph: SceneGraph,
  nodeId: string,
  targetHandle?: string
): SceneNode | undefined {
  const edge = graph.edges.find(
    (e) =>
      e.target === nodeId &&
      (targetHandle === undefined || e.targetHandle === targetHandle)
  );

  if (!edge) return undefined;
  return graph.nodes[edge.source];
}

/**
 * Find all downstream nodes connected to a source node's output
 */
export function getDownstreamNodes(
  graph: SceneGraph,
  nodeId: string
): SceneNode[] {
  const edges = getOutgoingEdges(graph, nodeId);
  return edges
    .map((edge) => graph.nodes[edge.target])
    .filter((node): node is SceneNode => node !== undefined);
}

// =============================================================================
// Chain Traversal
// =============================================================================

/**
 * Find the upstream chain from a node back to its source
 */
export function findUpstreamChain(
  graph: SceneGraph,
  nodeId: string
): UpstreamChain {
  const operationNodes: OperationNode[] = [];
  let currentNodeId = nodeId;
  let sourceNode: SourceNode | null = null;
  let groupNode: GroupNode | null = null;

  // Traverse backwards until we hit a source, group, or dead end
  while (true) {
    const currentNode = graph.nodes[currentNodeId];

    if (!currentNode) {
      // Dead end - node doesn't exist
      break;
    }

    if (isSourceNode(currentNode)) {
      // Found the source
      sourceNode = currentNode;
      break;
    }

    if (isGroupNode(currentNode)) {
      // Found a group node
      groupNode = currentNode;
      break;
    }

    if (isOperationNode(currentNode)) {
      // Add to operation chain (will reverse at the end)
      operationNodes.unshift(currentNode);

      // Find upstream connection
      const upstream = getUpstreamNode(graph, currentNodeId);
      if (!upstream) {
        // Dead end - no upstream connection
        break;
      }
      currentNodeId = upstream.id;
    } else {
      // Unknown node type
      break;
    }
  }

  return {
    sourceNode,
    groupNode,
    operationNodes,
    isComplete: sourceNode !== null || groupNode !== null,
  };
}

/**
 * Find all nodes downstream of a given node
 */
export function findAllDownstreamNodes(
  graph: SceneGraph,
  nodeId: string
): SceneNode[] {
  const visited = new Set<string>();
  const result: SceneNode[] = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const downstream = getDownstreamNodes(graph, currentId);
    for (const node of downstream) {
      if (!visited.has(node.id)) {
        result.push(node);
        queue.push(node.id);
      }
    }
  }

  return result;
}

/**
 * Find terminal nodes (nodes with no outgoing edges)
 */
export function findTerminalNodes(graph: SceneGraph): SceneNode[] {
  const nodesWithOutgoing = new Set(graph.edges.map((e) => e.source));

  return Object.values(graph.nodes).filter(
    (node) => !nodesWithOutgoing.has(node.id)
  );
}

// =============================================================================
// Effect Chain Building
// =============================================================================

/**
 * Map operation type to GPU effect name
 */
const OPERATION_TO_EFFECT_MAP: Record<OperationType, string> = {
  blur: 'gaussianBlur',
  color_correct: 'colorAdjust',
  transform: 'transform',
};

/**
 * Build effect configs from an operation chain
 */
export function buildEffectConfigs(
  operationNodes: OperationNode[]
): EffectConfig[] {
  return operationNodes.map((node) => ({
    id: node.id,
    effectName: OPERATION_TO_EFFECT_MAP[node.operationType] ?? node.operationType,
    parameters: node.params as unknown as Record<string, unknown>,
    enabled: node.isEnabled,
  }));
}

/**
 * Get the effect chain for a node (all operations from source to this node)
 */
export function getEffectChain(
  graph: SceneGraph,
  nodeId: string
): EffectConfig[] {
  const chain = findUpstreamChain(graph, nodeId);
  return buildEffectConfigs(chain.operationNodes);
}

// =============================================================================
// Asset Queries
// =============================================================================

/**
 * Find all asset IDs referenced by source nodes in a graph
 * @param layers - Optional layers map. If not provided, will access the LayerStore directly.
 */
export function getReferencedAssetIds(
  graph: SceneGraph,
  layers?: Record<string, Layer>
): string[] {
  const layerMap = layers ?? useLayerStore.getState().layers;
  const sourceNodes = getSourceNodes(graph);
  return sourceNodes
    .map((node) => layerMap[node.layerId]?.assetId)
    .filter((id): id is string => id !== undefined);
}

/**
 * Find source nodes referencing a specific asset
 * @param layers - Optional layers map. If not provided, will access the LayerStore directly.
 */
export function findSourceNodesForAsset(
  graph: SceneGraph,
  assetId: string,
  layers?: Record<string, Layer>
): SourceNode[] {
  const layerMap = layers ?? useLayerStore.getState().layers;
  return getSourceNodes(graph).filter(
    (node) => layerMap[node.layerId]?.assetId === assetId
  );
}

/**
 * Check if a graph contains any reference to an asset
 * @param layers - Optional layers map. If not provided, will access the LayerStore directly.
 */
export function graphReferencesAsset(
  graph: SceneGraph,
  assetId: string,
  layers?: Record<string, Layer>
): boolean {
  const layerMap = layers ?? useLayerStore.getState().layers;
  return getSourceNodes(graph).some(
    (node) => layerMap[node.layerId]?.assetId === assetId
  );
}

// =============================================================================
// Graph Validation
// =============================================================================

/**
 * Check if a graph has any cycles
 */
export function hasCycles(graph: SceneGraph): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const downstream = getDownstreamNodes(graph, nodeId);
    for (const node of downstream) {
      if (!visited.has(node.id)) {
        if (dfs(node.id)) return true;
      } else if (recursionStack.has(node.id)) {
        return true; // Back edge found - cycle!
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const nodeId of Object.keys(graph.nodes)) {
    if (!visited.has(nodeId)) {
      if (dfs(nodeId)) return true;
    }
  }

  return false;
}

/**
 * Topologically sort nodes (for rendering order)
 * Returns null if graph has cycles
 */
export function topologicalSort(graph: SceneGraph): SceneNode[] | null {
  if (hasCycles(graph)) return null;

  const inDegree = new Map<string, number>();
  const result: SceneNode[] = [];

  // Initialize in-degrees
  for (const nodeId of Object.keys(graph.nodes)) {
    inDegree.set(nodeId, 0);
  }

  // Count incoming edges
  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Start with nodes that have no incoming edges
  const queue = Object.keys(graph.nodes).filter(
    (id) => inDegree.get(id) === 0
  );

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = graph.nodes[nodeId];
    if (node) {
      result.push(node);
    }

    // Reduce in-degree of downstream nodes
    for (const downstream of getDownstreamNodes(graph, nodeId)) {
      const newDegree = (inDegree.get(downstream.id) ?? 0) - 1;
      inDegree.set(downstream.id, newDegree);
      if (newDegree === 0) {
        queue.push(downstream.id);
      }
    }
  }

  return result;
}

// =============================================================================
// Graph Modification Helpers
// =============================================================================

/**
 * Create a subgraph from selected nodes
 * Useful for containerizing nodes into a composition
 */
export function extractSubgraph(
  graph: SceneGraph,
  nodeIds: Set<string>
): SceneGraph {
  const nodes: Record<string, SceneNode> = {};
  const edges: Connection[] = [];

  // Copy selected nodes
  for (const nodeId of nodeIds) {
    const node = graph.nodes[nodeId];
    if (node) {
      nodes[nodeId] = { ...node };
    }
  }

  // Copy edges that are entirely within the selection
  for (const edge of graph.edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      edges.push({ ...edge });
    }
  }

  return { nodes, edges };
}

/**
 * Get nodes that would be external inputs to a subgraph
 * (nodes outside selection that connect into selected nodes)
 */
export function getExternalInputs(
  graph: SceneGraph,
  nodeIds: Set<string>
): Connection[] {
  return graph.edges.filter(
    (edge) => !nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );
}

/**
 * Get nodes that would be external outputs from a subgraph
 * (selected nodes that connect to nodes outside selection)
 */
export function getExternalOutputs(
  graph: SceneGraph,
  nodeIds: Set<string>
): Connection[] {
  return graph.edges.filter(
    (edge) => nodeIds.has(edge.source) && !nodeIds.has(edge.target)
  );
}
