/**
 * Graph Store
 *
 * Provides ReactFlow-compatible access to the active composition's graph.
 * Acts as a bridge between the AssetStore (source of truth) and ReactFlow.
 */

import { create } from 'zustand';
import type { Node as ReactFlowNode, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import type { SceneNode, SourceNode, OperationNode, Connection } from '../types/scene-graph';
import {
  isSourceNode,
  isOperationNode,
  generateConnectionId,
} from '../types/scene-graph';
import { useAssetStore } from './assetStore';
import { useCompositionStore } from './compositionStore';

// =============================================================================
// Types
// =============================================================================

/** ReactFlow node with SceneNode data */
export type FlowNode = ReactFlowNode<SceneNode>;

/** Data types for each node type */
export type SourceNodeData = SourceNode;
export type OperationNodeData = OperationNode;

interface GraphState {
  // ==========================================================================
  // Computed State (derived from active composition)
  // ==========================================================================

  /** Get nodes in ReactFlow format */
  getNodes: () => FlowNode[];

  /** Get edges in ReactFlow format */
  getEdges: () => Edge[];

  /** Get the raw scene graph */
  getSceneGraph: () => { nodes: Record<string, SceneNode>; edges: Connection[] } | null;

  // ==========================================================================
  // Node Operations
  // ==========================================================================

  /** Add a node to the active composition */
  addNode: (node: SceneNode) => void;

  /** Update a node in the active composition */
  updateNode: (
    id: string,
    updates: Partial<SceneNode> | ((node: SceneNode) => Partial<SceneNode>)
  ) => void;

  /** Remove a node from the active composition */
  removeNode: (id: string) => Promise<void>;

  // ==========================================================================
  // Edge Operations
  // ==========================================================================

  /** Add an edge to the active composition */
  addEdge: (edge: Edge) => void;

  /** Remove an edge from the active composition */
  removeEdge: (id: string) => void;

  // ==========================================================================
  // ReactFlow Integration
  // ==========================================================================

  /** Handle ReactFlow node changes */
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;

  /** Handle ReactFlow edge changes */
  onEdgesChange: (changes: EdgeChange[]) => void;

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /** Clear the entire graph */
  clearGraph: () => Promise<void>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the active composition ID
 */
function getActiveCompositionId(): string | null {
  return useCompositionStore.getState().activeCompositionId;
}

/**
 * Get the active composition's graph
 */
function getActiveGraph(): { nodes: Record<string, SceneNode>; edges: Connection[] } | null {
  return useCompositionStore.getState().getActiveGraph();
}

/**
 * Clean up OPFS files for a source node's asset
 */
async function cleanupSourceNodeAsset(node: SourceNode): Promise<void> {
  const assetStore = useAssetStore.getState();
  const asset = assetStore.getAsset(node.layer.assetId);

  if (!asset) return;

  // Check if any other source nodes reference this asset
  const compositionId = getActiveCompositionId();
  if (!compositionId) return;

  const graph = getActiveGraph();
  if (!graph) return;

  const otherReferences = Object.values(graph.nodes).filter(
    (n) =>
      n.id !== node.id &&
      isSourceNode(n) &&
      n.layer.assetId === node.layer.assetId
  );

  // Only delete asset if no other references
  if (otherReferences.length === 0) {
    await assetStore.removeAsset(node.layer.assetId);
  }
}

/**
 * Convert SceneNode to ReactFlow node
 */
function sceneNodeToFlowNode(node: SceneNode): FlowNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position ?? { x: 0, y: 0 },
    data: node,
    selected: node.selected ?? false,
    dragging: false,
    draggable: true,
    selectable: true,
    connectable: true,
  };
}

/**
 * Convert Connection to ReactFlow edge
 */
function connectionToFlowEdge(conn: Connection): Edge {
  return {
    id: conn.id,
    source: conn.source,
    target: conn.target,
    sourceHandle: conn.sourceHandle,
    targetHandle: conn.targetHandle,
  };
}

// =============================================================================
// Store
// =============================================================================

export const useGraphStore = create<GraphState>()(() => ({
  // ==========================================================================
  // Computed State
  // ==========================================================================

  getNodes: () => {
    const graph = getActiveGraph();
    if (!graph) return [];

    return Object.values(graph.nodes).map(sceneNodeToFlowNode);
  },

  getEdges: () => {
    const graph = getActiveGraph();
    if (!graph) return [];

    return graph.edges.map(connectionToFlowEdge);
  },

  getSceneGraph: () => {
    return getActiveGraph();
  },

  // ==========================================================================
  // Node Operations
  // ==========================================================================

  addNode: (node) => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) {
      console.warn('No active composition to add node to');
      return;
    }

    useAssetStore.getState().addNodeToComposition(compositionId, node);
  },

  updateNode: (id, updates) => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) return;

    const graph = getActiveGraph();
    if (!graph) return;

    const existingNode = graph.nodes[id];
    if (!existingNode) return;

    const resolvedUpdates =
      typeof updates === 'function' ? updates(existingNode) : updates;

    useAssetStore
      .getState()
      .updateNodeInComposition(compositionId, id, resolvedUpdates);
  },

  removeNode: async (id) => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) return;

    const graph = getActiveGraph();
    if (!graph) return;

    const node = graph.nodes[id];
    if (!node) return;

    // Clean up asset if this is a source node
    if (isSourceNode(node)) {
      await cleanupSourceNodeAsset(node);
    }

    useAssetStore.getState().removeNodeFromComposition(compositionId, id);
  },

  // ==========================================================================
  // Edge Operations
  // ==========================================================================

  addEdge: (edge) => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) return;

    const connection: Connection = {
      id: edge.id || generateConnectionId(),
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    };

    useAssetStore.getState().addEdgeToComposition(compositionId, connection);

    // Update the source node's layer.effects array if connecting to an operation
    const graph = getActiveGraph();
    if (graph) {
      const sourceNode = graph.nodes[edge.source];
      const targetNode = graph.nodes[edge.target];

      if (isSourceNode(sourceNode) && isOperationNode(targetNode)) {
        // Add the operation to the source's effects tracking
        const newEffects = [...sourceNode.layer.effects, targetNode.id];
        useAssetStore.getState().updateNodeInComposition(compositionId, edge.source, {
          layer: {
            ...sourceNode.layer,
            effects: newEffects,
          },
        } as Partial<SourceNode>);
      }
    }
  },

  removeEdge: (id) => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) return;

    // Find the edge before removing to update layer.effects
    const graph = getActiveGraph();
    if (graph) {
      const edge = graph.edges.find((e) => e.id === id);
      if (edge) {
        const sourceNode = graph.nodes[edge.source];
        const targetNode = graph.nodes[edge.target];

        if (isSourceNode(sourceNode) && isOperationNode(targetNode)) {
          // Remove the operation from the source's effects tracking
          const newEffects = sourceNode.layer.effects.filter(
            (effectId) => effectId !== targetNode.id
          );
          useAssetStore.getState().updateNodeInComposition(compositionId, edge.source, {
            layer: {
              ...sourceNode.layer,
              effects: newEffects,
            },
          } as Partial<SourceNode>);
        }
      }
    }

    useAssetStore.getState().removeEdgeFromComposition(compositionId, id);
  },

  // ==========================================================================
  // ReactFlow Integration
  // ==========================================================================

  onNodesChange: (changes) => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) return;

    const graph = getActiveGraph();
    if (!graph) return;

    // Process each change
    for (const change of changes) {
      switch (change.type) {
        case 'position':
          if (change.position) {
            const node = graph.nodes[change.id];
            if (node) {
              useAssetStore
                .getState()
                .updateNodeInComposition(compositionId, change.id, {
                  position: change.position,
                });
            }
          }
          break;

        case 'select':
          useAssetStore
            .getState()
            .updateNodeInComposition(compositionId, change.id, {
              selected: change.selected,
            });
          break;

        case 'remove':
          // Handle async cleanup
          const nodeToRemove = graph.nodes[change.id];
          if (nodeToRemove && isSourceNode(nodeToRemove)) {
            cleanupSourceNodeAsset(nodeToRemove).catch(console.error);
          }
          useAssetStore
            .getState()
            .removeNodeFromComposition(compositionId, change.id);
          break;

        case 'dimensions':
          // ReactFlow dimension updates - can ignore for scene graph
          break;

        case 'add':
          // Node additions should go through addNode
          break;
      }
    }
  },

  onEdgesChange: (changes) => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) return;

    const assetStore = useAssetStore.getState();

    for (const change of changes) {
      switch (change.type) {
        case 'add':
          if ('item' in change && change.item) {
            const edge = change.item;
            const connection: Connection = {
              id: edge.id || generateConnectionId(),
              source: edge.source,
              target: edge.target,
              sourceHandle: edge.sourceHandle ?? undefined,
              targetHandle: edge.targetHandle ?? undefined,
            };
            assetStore.addEdgeToComposition(compositionId, connection);
          }
          break;

        case 'remove':
          assetStore.removeEdgeFromComposition(compositionId, change.id);
          break;

        case 'select':
          // Edge selection - not stored in scene graph
          break;
      }
    }
  },

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  clearGraph: async () => {
    const compositionId = getActiveCompositionId();
    if (!compositionId) return;

    const graph = getActiveGraph();
    if (!graph) return;

    // Clean up all source node assets
    const sourceNodes = Object.values(graph.nodes).filter(isSourceNode);
    for (const node of sourceNodes) {
      await cleanupSourceNodeAsset(node);
    }

    // Clear the graph
    useAssetStore
      .getState()
      .updateCompositionGraph(compositionId, {}, []);
  },
}));

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select nodes as ReactFlow format
 */
export const selectNodes = (): FlowNode[] => {
  return useGraphStore.getState().getNodes();
};

/**
 * Select edges as ReactFlow format
 */
export const selectEdges = (): Edge[] => {
  return useGraphStore.getState().getEdges();
};

/**
 * Select a specific node by ID
 */
export const selectNode = (id: string): SceneNode | undefined => {
  const graph = useGraphStore.getState().getSceneGraph();
  return graph?.nodes[id];
};

/**
 * Select source nodes only
 */
export const selectSourceNodes = (): SourceNode[] => {
  const graph = useGraphStore.getState().getSceneGraph();
  if (!graph) return [];
  return Object.values(graph.nodes).filter(isSourceNode);
};

/**
 * Select operation nodes only
 */
export const selectOperationNodes = (): OperationNode[] => {
  const graph = useGraphStore.getState().getSceneGraph();
  if (!graph) return [];
  return Object.values(graph.nodes).filter(isOperationNode);
};

// =============================================================================
// Hooks for ReactFlow Integration
// =============================================================================

/**
 * Hook to get nodes with automatic updates
 * Properly subscribes to asset store changes to trigger re-renders
 */
export function useGraphNodes(): FlowNode[] {
  // Subscribe to active composition ID
  const activeCompId = useCompositionStore((s) => s.activeCompositionId);

  // Subscribe to the specific composition's graph in the asset store
  const composition = useAssetStore((s) => {
    if (!activeCompId) return null;
    const asset = s.assets[activeCompId];
    if (asset && asset.type === 'composition') {
      return asset;
    }
    return null;
  });

  if (!composition || composition.type !== 'composition') return [];

  // Convert nodes with proper defaults for ReactFlow
  return Object.values(composition.graph.nodes).map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position ?? { x: 0, y: 0 },
    data: node,
    selected: node.selected ?? false,
    dragging: false,
    draggable: true,
    selectable: true,
    connectable: true,
  }));
}

/**
 * Hook to get edges with automatic updates
 */
export function useGraphEdges(): Edge[] {
  // Subscribe to active composition ID
  const activeCompId = useCompositionStore((s) => s.activeCompositionId);

  // Subscribe to the specific composition's graph in the asset store
  const composition = useAssetStore((s) => {
    if (!activeCompId) return null;
    const asset = s.assets[activeCompId];
    if (asset && asset.type === 'composition') {
      return asset;
    }
    return null;
  });

  if (!composition || composition.type !== 'composition') return [];

  return composition.graph.edges.map(connectionToFlowEdge);
}
