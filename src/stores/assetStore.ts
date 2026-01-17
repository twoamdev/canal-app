import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Asset,
  VideoAsset,
  ImageAsset,
  ShapeAsset,
  CompositionAsset,
} from '../types/assets';
import {
  isVideoAsset,
  isImageAsset,
  isShapeAsset,
  isCompositionAsset,
} from '../types/assets';
import type { SceneNode, Connection } from '../types/scene-graph';
import { opfsManager } from '../utils/opfs';
import { deleteVideoFrames, getFramesFolderPath } from '../utils/frame-storage';

// =============================================================================
// Types
// =============================================================================

interface AssetState {
  /** All assets indexed by ID */
  assets: Record<string, Asset>;
  /** ID of the root composition (main project) */
  rootCompositionId: string | null;

  // Asset CRUD
  addAsset: (asset: Asset) => void;
  updateAsset: (id: string, updates: Partial<Asset>) => void;
  removeAsset: (id: string) => Promise<void>;

  // Bulk operations
  setAssets: (assets: Record<string, Asset>) => void;
  clearAssets: () => Promise<void>;

  // Typed getters
  getAsset: (id: string) => Asset | undefined;
  getVideoAsset: (id: string) => VideoAsset | undefined;
  getImageAsset: (id: string) => ImageAsset | undefined;
  getShapeAsset: (id: string) => ShapeAsset | undefined;
  getCompositionAsset: (id: string) => CompositionAsset | undefined;

  // Asset queries
  getAssetsByType: <T extends Asset['type']>(type: T) => Asset[];
  findAssetByFileHandle: (fileHandleId: string) => Asset | undefined;

  // Root composition management
  setRootComposition: (id: string) => void;
  getRootComposition: () => CompositionAsset | undefined;
  initializeRootComposition: () => string;

  // Composition graph operations
  updateCompositionGraph: (
    compositionId: string,
    nodes: Record<string, SceneNode>,
    edges: Connection[]
  ) => void;
  addNodeToComposition: (compositionId: string, node: SceneNode) => void;
  removeNodeFromComposition: (compositionId: string, nodeId: string) => void;
  updateNodeInComposition: (
    compositionId: string,
    nodeId: string,
    updates: Partial<SceneNode>
  ) => void;
  addEdgeToComposition: (compositionId: string, edge: Connection) => void;
  removeEdgeFromComposition: (compositionId: string, edgeId: string) => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Clean up OPFS files associated with an asset
 */
async function cleanupAssetFiles(asset: Asset): Promise<void> {
  if (isVideoAsset(asset)) {
    const { fileHandleId, frameCount, extractedFrameFormat, isImageSequence, sequenceFramePaths } = asset.metadata;

    if (isImageSequence) {
      // Image sequence: delete frames using sequenceFramePaths and then delete the directory
      if (sequenceFramePaths) {
        const framePaths = Object.values(sequenceFramePaths);
        const deletePromises = framePaths.map((framePath) =>
          opfsManager.deleteFile(framePath).catch((err) => {
            // Ignore errors for individual frames
            console.warn(`Failed to delete sequence frame ${framePath}:`, err);
          })
        );
        await Promise.all(deletePromises);
        console.log(`Deleted ${framePaths.length} sequence frames for: ${fileHandleId}`);
      }

      // Delete the sequence directory (fileHandleId is the base directory path)
      try {
        await opfsManager.deleteDirectory(fileHandleId);
        console.log(`Deleted sequence directory: ${fileHandleId}`);
      } catch (error) {
        console.error(`Failed to delete sequence directory ${fileHandleId}:`, error);
      }
    } else {
      // Regular video: delete extracted frames using getFramePath pattern
      if (extractedFrameFormat && frameCount > 0) {
        try {
          await deleteVideoFrames(fileHandleId, frameCount, extractedFrameFormat);
          console.log(`Deleted ${frameCount} extracted frames for: ${fileHandleId}`);

          // Also delete the frames folder
          const framesFolder = getFramesFolderPath(fileHandleId);
          try {
            await opfsManager.deleteDirectory(framesFolder);
            console.log(`Deleted frames folder: ${framesFolder}`);
          } catch (err) {
            // Folder might already be empty or not exist
            console.warn(`Could not delete frames folder ${framesFolder}:`, err);
          }
        } catch (error) {
          console.error(`Failed to delete extracted frames for ${fileHandleId}:`, error);
        }
      }

      // Delete original video file
      try {
        await opfsManager.deleteFile(fileHandleId);
        console.log(`Deleted OPFS file: ${fileHandleId}`);
      } catch (error) {
        console.error(`Failed to delete OPFS file ${fileHandleId}:`, error);
      }
    }
  } else if (isImageAsset(asset)) {
    const { fileHandleId } = asset.metadata;
    try {
      await opfsManager.deleteFile(fileHandleId);
      console.log(`Deleted OPFS file: ${fileHandleId}`);
    } catch (error) {
      console.error(`Failed to delete OPFS file ${fileHandleId}:`, error);
    }
  }
  // ShapeAssets and CompositionAssets don't have OPFS files
}

/**
 * Create a new empty root composition
 */
function createRootComposition(): CompositionAsset {
  const now = Date.now();
  const defaultDuration = 300; // 10 seconds at 30fps
  return {
    id: `comp_root_${now}`,
    type: 'composition',
    name: 'Main Composition',
    intrinsicWidth: 1920,
    intrinsicHeight: 1080,
    dimensions: { width: 1920, height: 1080 },
    fps: 30,
    durationFrames: defaultDuration,
    workAreaStart: 0,
    workAreaEnd: defaultDuration,
    createdAt: now,
    updatedAt: now,
    graph: {
      nodes: {},
      edges: [],
    },
  };
}

// =============================================================================
// Store
// =============================================================================

export const useAssetStore = create<AssetState>()(
  persist(
    (set, get) => ({
      // Initial state
      assets: {},
      rootCompositionId: null,

      // =======================================================================
      // Asset CRUD
      // =======================================================================

      addAsset: (asset) => {
        set((state) => ({
          assets: {
            ...state.assets,
            [asset.id]: asset,
          },
        }));
      },

      updateAsset: (id, updates) => {
        set((state) => {
          const existing = state.assets[id];
          if (!existing) return state;

          return {
            assets: {
              ...state.assets,
              [id]: {
                ...existing,
                ...updates,
                updatedAt: Date.now(),
              } as Asset,
            },
          };
        });
      },

      removeAsset: async (id) => {
        const asset = get().assets[id];
        if (asset) {
          // Clean up OPFS files
          await cleanupAssetFiles(asset);
        }

        set((state) => {
          const { [id]: removed, ...remaining } = state.assets;
          return { assets: remaining };
        });
      },

      setAssets: (assets) => {
        set({ assets });
      },

      clearAssets: async () => {
        const assets = Object.values(get().assets);

        // Clean up all OPFS files
        for (const asset of assets) {
          await cleanupAssetFiles(asset);
        }

        set({ assets: {}, rootCompositionId: null });
      },

      // =======================================================================
      // Typed Getters
      // =======================================================================

      getAsset: (id) => get().assets[id],

      getVideoAsset: (id) => {
        const asset = get().assets[id];
        return asset && isVideoAsset(asset) ? asset : undefined;
      },

      getImageAsset: (id) => {
        const asset = get().assets[id];
        return asset && isImageAsset(asset) ? asset : undefined;
      },

      getShapeAsset: (id) => {
        const asset = get().assets[id];
        return asset && isShapeAsset(asset) ? asset : undefined;
      },

      getCompositionAsset: (id) => {
        const asset = get().assets[id];
        return asset && isCompositionAsset(asset) ? asset : undefined;
      },

      // =======================================================================
      // Asset Queries
      // =======================================================================

      getAssetsByType: (type) => {
        return Object.values(get().assets).filter((asset) => asset.type === type);
      },

      findAssetByFileHandle: (fileHandleId) => {
        return Object.values(get().assets).find((asset) => {
          if (isVideoAsset(asset) || isImageAsset(asset)) {
            return asset.metadata.fileHandleId === fileHandleId;
          }
          return false;
        });
      },

      // =======================================================================
      // Root Composition Management
      // =======================================================================

      setRootComposition: (id) => {
        set({ rootCompositionId: id });
      },

      getRootComposition: () => {
        const { rootCompositionId, assets } = get();
        if (!rootCompositionId) return undefined;

        const asset = assets[rootCompositionId];
        return asset && isCompositionAsset(asset) ? asset : undefined;
      },

      initializeRootComposition: () => {
        const existing = get().getRootComposition();
        if (existing) {
          return existing.id;
        }

        // Create a new root composition
        const rootComp = createRootComposition();
        set((state) => ({
          assets: {
            ...state.assets,
            [rootComp.id]: rootComp,
          },
          rootCompositionId: rootComp.id,
        }));

        return rootComp.id;
      },

      // =======================================================================
      // Composition Graph Operations
      // =======================================================================

      updateCompositionGraph: (compositionId, nodes, edges) => {
        set((state) => {
          const comp = state.assets[compositionId];
          if (!comp || !isCompositionAsset(comp)) return state;

          return {
            assets: {
              ...state.assets,
              [compositionId]: {
                ...comp,
                graph: { nodes, edges },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      addNodeToComposition: (compositionId, node) => {
        set((state) => {
          const comp = state.assets[compositionId];
          if (!comp || !isCompositionAsset(comp)) return state;

          return {
            assets: {
              ...state.assets,
              [compositionId]: {
                ...comp,
                graph: {
                  ...comp.graph,
                  nodes: {
                    ...comp.graph.nodes,
                    [node.id]: node,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      removeNodeFromComposition: (compositionId, nodeId) => {
        set((state) => {
          const comp = state.assets[compositionId];
          if (!comp || !isCompositionAsset(comp)) return state;

          const { [nodeId]: removed, ...remainingNodes } = comp.graph.nodes;
          // Also remove any edges connected to this node
          const remainingEdges = comp.graph.edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId
          );

          return {
            assets: {
              ...state.assets,
              [compositionId]: {
                ...comp,
                graph: {
                  nodes: remainingNodes,
                  edges: remainingEdges,
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateNodeInComposition: (compositionId, nodeId, updates) => {
        set((state) => {
          const comp = state.assets[compositionId];
          if (!comp || !isCompositionAsset(comp)) return state;

          const existingNode = comp.graph.nodes[nodeId];
          if (!existingNode) return state;

          return {
            assets: {
              ...state.assets,
              [compositionId]: {
                ...comp,
                graph: {
                  ...comp.graph,
                  nodes: {
                    ...comp.graph.nodes,
                    [nodeId]: {
                      ...existingNode,
                      ...updates,
                    } as SceneNode,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      addEdgeToComposition: (compositionId, edge) => {
        set((state) => {
          const comp = state.assets[compositionId];
          if (!comp || !isCompositionAsset(comp)) return state;

          // Enforce single-connection-per-input: remove existing edge to same target+handle
          const filteredEdges = comp.graph.edges.filter(
            (e) =>
              !(e.target === edge.target && e.targetHandle === edge.targetHandle)
          );

          return {
            assets: {
              ...state.assets,
              [compositionId]: {
                ...comp,
                graph: {
                  ...comp.graph,
                  edges: [...filteredEdges, edge],
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      removeEdgeFromComposition: (compositionId, edgeId) => {
        set((state) => {
          const comp = state.assets[compositionId];
          if (!comp || !isCompositionAsset(comp)) return state;

          return {
            assets: {
              ...state.assets,
              [compositionId]: {
                ...comp,
                graph: {
                  ...comp.graph,
                  edges: comp.graph.edges.filter((e) => e.id !== edgeId),
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },
    }),
    {
      name: 'canal-asset-storage',
      version: 1,
      // Don't persist functions, only state
      partialize: (state) => ({
        assets: state.assets,
        rootCompositionId: state.rootCompositionId,
      }),
    }
  )
);

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select assets by type
 */
export const selectVideoAssets = (state: AssetState) =>
  Object.values(state.assets).filter(isVideoAsset);

export const selectImageAssets = (state: AssetState) =>
  Object.values(state.assets).filter(isImageAsset);

export const selectShapeAssets = (state: AssetState) =>
  Object.values(state.assets).filter(isShapeAsset);

export const selectCompositionAssets = (state: AssetState) =>
  Object.values(state.assets).filter(isCompositionAsset);

/**
 * Select the root composition's graph
 */
export const selectRootGraph = (state: AssetState) => {
  const rootComp = state.getRootComposition();
  return rootComp?.graph ?? null;
};
