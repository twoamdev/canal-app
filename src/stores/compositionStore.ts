import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SceneNode, Connection } from '../types/scene-graph';
import { useAssetStore } from './assetStore';
import { isCompositionAsset } from '../types/assets';

// =============================================================================
// Types
// =============================================================================

interface CompositionState {
  /** ID of the composition currently being edited */
  activeCompositionId: string | null;

  /**
   * Stack of composition IDs for nested editing
   * First element is the root, last is the current
   * Future: used for breadcrumb navigation
   */
  compositionStack: string[];

  // Navigation
  setActiveComposition: (id: string) => void;
  enterComposition: (id: string) => void;
  exitComposition: () => void;
  exitToRoot: () => void;

  // Getters
  getActiveGraph: () => { nodes: Record<string, SceneNode>; edges: Connection[] } | null;
  getActiveCompositionId: () => string | null;
  isInsideSubcomposition: () => boolean;
  getBreadcrumbs: () => Array<{ id: string; name: string }>;
}

// =============================================================================
// Store
// =============================================================================

export const useCompositionStore = create<CompositionState>()(
  persist(
    (set, get) => ({
  // Initial state
  activeCompositionId: null,
  compositionStack: [],

  // ==========================================================================
  // Navigation
  // ==========================================================================

  setActiveComposition: (id) => {
    set({
      activeCompositionId: id,
      compositionStack: [id],
    });
  },

  enterComposition: (id) => {
    // Entering a subcomposition
    set((state) => ({
      activeCompositionId: id,
      compositionStack: [...state.compositionStack, id],
    }));
  },

  exitComposition: () => {
    set((state) => {
      if (state.compositionStack.length <= 1) {
        // Already at root, can't exit further
        return state;
      }

      const newStack = state.compositionStack.slice(0, -1);
      return {
        activeCompositionId: newStack[newStack.length - 1],
        compositionStack: newStack,
      };
    });
  },

  exitToRoot: () => {
    set((state) => {
      if (state.compositionStack.length === 0) {
        return state;
      }

      const rootId = state.compositionStack[0];
      return {
        activeCompositionId: rootId,
        compositionStack: [rootId],
      };
    });
  },

  // ==========================================================================
  // Getters
  // ==========================================================================

  getActiveGraph: () => {
    const { activeCompositionId } = get();
    if (!activeCompositionId) return null;

    const asset = useAssetStore.getState().getAsset(activeCompositionId);
    if (!asset || !isCompositionAsset(asset)) return null;

    return asset.graph;
  },

  getActiveCompositionId: () => {
    return get().activeCompositionId;
  },

  isInsideSubcomposition: () => {
    return get().compositionStack.length > 1;
  },

  getBreadcrumbs: () => {
    const { compositionStack } = get();
    const assetStore = useAssetStore.getState();

    return compositionStack.map((id) => {
      const asset = assetStore.getAsset(id);
      return {
        id,
        name: asset?.name ?? 'Unknown',
      };
    });
  },
    }),
    {
      name: 'canal-composition-storage',
      version: 1,
      partialize: (state) => ({
        activeCompositionId: state.activeCompositionId,
        compositionStack: state.compositionStack,
      }),
    }
  )
);

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the composition system
 * Call this once at app startup
 */
export function initializeCompositionSystem(): void {
  const assetStore = useAssetStore.getState();
  const compositionStore = useCompositionStore.getState();

  // Ensure we have a root composition
  const rootCompId = assetStore.initializeRootComposition();

  // Set it as the active composition if not already set
  // Also validate that the active composition still exists in assets
  const currentActiveId = compositionStore.activeCompositionId;
  const currentActiveValid = currentActiveId && assetStore.getAsset(currentActiveId);

  if (!currentActiveValid) {
    compositionStore.setActiveComposition(rootCompId);
  }
}

// Auto-initialize on module load (after stores are hydrated)
// This ensures the composition system is ready before any React renders
if (typeof window !== 'undefined') {
  // Wait for next tick to ensure stores are hydrated from localStorage
  setTimeout(() => {
    initializeCompositionSystem();
  }, 0);
}

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select the active composition's nodes as an array
 */
export const selectActiveNodes = (): SceneNode[] => {
  const graph = useCompositionStore.getState().getActiveGraph();
  if (!graph) return [];
  return Object.values(graph.nodes);
};

/**
 * Select the active composition's edges
 */
export const selectActiveEdges = (): Connection[] => {
  const graph = useCompositionStore.getState().getActiveGraph();
  if (!graph) return [];
  return graph.edges;
};
