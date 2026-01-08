import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { initialNodes, initialEdges } from '../constants/initialGraphNodes';
import type { GraphNode, ExtractedFramesInfo } from '../types/nodes';
import { opfsManager } from '../utils/opfs';
import { deleteVideoFrames } from '../utils/frame-storage';

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
      setEdges: (edges) => set({ edges }),
      
      // ReactFlow change handlers
      onNodesChange: (changes) => {
        set((state) => {
          // Find nodes that are being removed
          const removedNodeIds = new Set<string>();
          changes.forEach((change) => {
            if (change.type === 'remove') {
              removedNodeIds.add(change.id);
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

          return {
            nodes: applyNodeChanges(changes, state.nodes) as GraphNode[],
          };
        });
      },
      
      onEdgesChange: (changes) => {
        set((state) => ({
          edges: applyEdgeChanges(changes, state.edges),
        }));
      },
      
      addNode: (node) =>
        set((state) => ({
          nodes: [...state.nodes, node],
        })),

      updateNode: (id, updates) =>
        set((state) => ({
          nodes: state.nodes.map((node) => {
            if (node.id !== id) return node;
            const resolvedUpdates = typeof updates === 'function' ? updates(node) : updates;
            return { ...node, ...resolvedUpdates } as GraphNode;
          }),
        })),

      replaceNodeType: (id, newType, newData) =>
        set((state) => ({
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
        })),

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
        set((state) => ({
          edges: [...state.edges, edge],
        })),

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