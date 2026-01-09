import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { initialNodes, initialEdges } from '../constants/initialGraphNodes';
import type { GraphNode, ExtractedFramesInfo } from '../types/nodes';
import { opfsManager } from '../utils/opfs';
import { deleteVideoFrames } from '../utils/frame-storage';
import { invalidateLayerCache, clearLayerCache } from '../utils/layer-metadata';

// Helper function to clean up OPFS file and extracted frames if node has file data
async function cleanupNodeFile(node: GraphNode): Promise<void> {
  // Check if this is a file node with OPFS path
  if ('file' in node.data && node.data.file && typeof node.data.file === 'object') {
    const fileData = node.data.file as { opfsPath?: string };
    const extractedFrames = (node.data as { extractedFrames?: ExtractedFramesInfo }).extractedFrames;

    // Delete extracted frames if they exist
    if (fileData.opfsPath && extractedFrames) {
      try {
        await deleteVideoFrames(fileData.opfsPath, extractedFrames.frameCount, extractedFrames.format);
        console.log(`Deleted ${extractedFrames.frameCount} extracted frames for: ${fileData.opfsPath}`);
      } catch (error) {
        console.error(`Failed to delete extracted frames for ${fileData.opfsPath}:`, error);
      }
    }

    // Delete original file
    if (fileData.opfsPath) {
      try {
        await opfsManager.deleteFile(fileData.opfsPath);
        console.log(`Deleted OPFS file: ${fileData.opfsPath}`);
      } catch (error) {
        console.error(`Failed to delete OPFS file ${fileData.opfsPath}:`, error);
        // Don't throw - allow node deletion even if file cleanup fails
      }
    }
  }
}

interface GraphState {
  nodes: GraphNode[];
  edges: Edge[];

  setNodes: (nodes: GraphNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addNode: (node: GraphNode) => void;
  updateNode: (id: string, updates: Partial<GraphNode> | ((node: GraphNode) => Partial<GraphNode>)) => void;
  replaceNodeType: (id: string, newType: string, newData: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: Edge) => void;
  removeEdge: (id: string) => void;
  clearGraph: () => void;
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set) => ({
      // Initial state
      nodes: initialNodes as GraphNode[],
      edges: initialEdges,

      // Actions
      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => {
        // Enforce single-connection-per-input: keep only the last edge for each target+targetHandle
        const seenTargets = new Map<string, Edge>();
        // Process in reverse so the "last" (newest) edge wins
        for (let i = edges.length - 1; i >= 0; i--) {
          const edge = edges[i];
          const key = `${edge.target}:${edge.targetHandle ?? 'default'}`;
          if (!seenTargets.has(key)) {
            seenTargets.set(key, edge);
          }
        }
        // Restore original order
        const filteredEdges = edges.filter((edge) => {
          const key = `${edge.target}:${edge.targetHandle ?? 'default'}`;
          return seenTargets.get(key) === edge;
        });
        set({ edges: filteredEdges });
      },
      
      // ReactFlow change handlers
      onNodesChange: (changes) => {
        set((state) => {
          // Find nodes that are being removed or modified
          const removedNodeIds = new Set<string>();
          const changedNodeIds = new Set<string>();

          changes.forEach((change) => {
            if (change.type === 'remove') {
              removedNodeIds.add(change.id);
              changedNodeIds.add(change.id);
            } else if ('id' in change) {
              // Any other change type with an ID should invalidate cache
              changedNodeIds.add(change.id);
            }
          });

          // Clean up OPFS files for removed nodes
          if (removedNodeIds.size > 0) {
            state.nodes
              .filter((node) => removedNodeIds.has(node.id))
              .forEach((node) => {
                cleanupNodeFile(node).catch(console.error);
              });
          }

          // Invalidate layer cache for changed nodes
          changedNodeIds.forEach((nodeId) => {
            invalidateLayerCache(nodeId, state.nodes, state.edges);
          });

          return {
            nodes: applyNodeChanges(changes, state.nodes) as GraphNode[],
          };
        });
      },
      
      onEdgesChange: (changes) => {
        set((state) => {
          // Collect affected target nodes for cache invalidation
          const affectedTargets = new Set<string>();

          changes.forEach((change) => {
            if (change.type === 'add' && 'item' in change) {
              affectedTargets.add(change.item.target);
            } else if (change.type === 'remove') {
              // Find the edge being removed to get its target
              const edge = state.edges.find((e) => e.id === change.id);
              if (edge) {
                affectedTargets.add(edge.target);
              }
            }
          });

          const newEdges = applyEdgeChanges(changes, state.edges);

          // Enforce single-connection-per-input: keep only the last edge for each target+targetHandle
          const seenTargets = new Map<string, Edge>();
          // Process in reverse so the "last" (newest) edge wins
          for (let i = newEdges.length - 1; i >= 0; i--) {
            const edge = newEdges[i];
            const key = `${edge.target}:${edge.targetHandle ?? 'default'}`;
            if (!seenTargets.has(key)) {
              seenTargets.set(key, edge);
            }
          }
          // Restore original order
          const filteredEdges = newEdges.filter((edge) => {
            const key = `${edge.target}:${edge.targetHandle ?? 'default'}`;
            return seenTargets.get(key) === edge;
          });

          // Invalidate layer cache for affected target nodes
          affectedTargets.forEach((targetId) => {
            invalidateLayerCache(targetId, state.nodes, filteredEdges);
          });

          return { edges: filteredEdges };
        });
      },
      
      addNode: (node) =>
        set((state) => ({
          nodes: [...state.nodes, node],
        })),

      updateNode: (id, updates) =>
        set((state) => {
          // Invalidate layer cache for this node (updates might change layer metadata)
          invalidateLayerCache(id, state.nodes, state.edges);

          return {
            nodes: state.nodes.map((node) => {
              if (node.id !== id) return node;
              const resolvedUpdates = typeof updates === 'function' ? updates(node) : updates;
              return { ...node, ...resolvedUpdates } as GraphNode;
            }),
          };
        }),

      replaceNodeType: (id, newType, newData) =>
        set((state) => {
          // Invalidate layer cache for this node (type change affects layer metadata)
          invalidateLayerCache(id, state.nodes, state.edges);

          return {
            nodes: state.nodes.map((node) => {
              if (node.id !== id) return node;
              // Preserve position, selected state, and other ReactFlow properties
              // but replace type and data
              return {
                ...node,
                type: newType,
                data: newData,
              } as GraphNode;
            }),
          };
        }),

      removeNode: (id) =>
        set((state) => {
          // Find the node being removed
          const nodeToRemove = state.nodes.find((node) => node.id === id);
          
          // Clean up OPFS file if it's a file node
          if (nodeToRemove) {
            cleanupNodeFile(nodeToRemove).catch(console.error);
          }

          return {
            nodes: state.nodes.filter((node) => node.id !== id),
            edges: state.edges.filter(
              (edge) => edge.source !== id && edge.target !== id
            ),
          };
        }),

      addEdge: (edge) =>
        set((state) => {
          // Remove any existing edge to the same target+targetHandle (single connection per input)
          const key = `${edge.target}:${edge.targetHandle ?? 'default'}`;
          const filteredEdges = state.edges.filter((e) => {
            const eKey = `${e.target}:${e.targetHandle ?? 'default'}`;
            return eKey !== key;
          });

          // Invalidate layer cache for the target node (new connection affects layer metadata)
          invalidateLayerCache(edge.target, state.nodes, [...filteredEdges, edge]);

          return { edges: [...filteredEdges, edge] };
        }),

      removeEdge: (id) =>
        set((state) => ({
          edges: state.edges.filter((edge) => edge.id !== id),
        })),

      clearGraph: () =>
        set((state) => {
          // Clean up all file nodes' OPFS storage
          state.nodes.forEach((node) => {
            cleanupNodeFile(node).catch(console.error);
          });

          // Clear the entire layer cache
          clearLayerCache();

          return {
            nodes: initialNodes as GraphNode[],
            edges: initialEdges,
          };
        }),
    }),
    {
      name: 'canal-graph-storage',
      version: 1,
    }
  )
);