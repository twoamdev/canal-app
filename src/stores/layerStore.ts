import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layer } from '../types/scene-graph';

// =============================================================================
// Types
// =============================================================================

interface LayerState {
  /** All layers indexed by ID */
  layers: Record<string, Layer>;

  // Layer CRUD
  addLayer: (layer: Layer) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  removeLayer: (id: string) => void;

  // Bulk operations
  setLayers: (layers: Record<string, Layer>) => void;
  clearLayers: () => void;

  // Getters
  getLayer: (id: string) => Layer | undefined;
  getLayersByAssetId: (assetId: string) => Layer[];

  // Utilities
  isLayerId: (id: string) => boolean;
}

// =============================================================================
// Store
// =============================================================================

export const useLayerStore = create<LayerState>()(
  persist(
    (set, get) => ({
      // Initial state
      layers: {},

      // ========================================================================
      // Layer CRUD
      // ========================================================================

      addLayer: (layer) => {
        set((state) => ({
          layers: {
            ...state.layers,
            [layer.id]: layer,
          },
        }));
      },

      updateLayer: (id, updates) => {
        set((state) => {
          const existing = state.layers[id];
          if (!existing) {
            console.warn(`[LayerStore] Cannot update non-existent layer: ${id}`);
            return state;
          }
          return {
            layers: {
              ...state.layers,
              [id]: { ...existing, ...updates },
            },
          };
        });
      },

      removeLayer: (id) => {
        set((state) => {
          const { [id]: removed, ...rest } = state.layers;
          if (!removed) {
            console.warn(`[LayerStore] Cannot remove non-existent layer: ${id}`);
          }
          return { layers: rest };
        });
      },

      // ========================================================================
      // Bulk Operations
      // ========================================================================

      setLayers: (layers) => {
        set({ layers });
      },

      clearLayers: () => {
        set({ layers: {} });
      },

      // ========================================================================
      // Getters
      // ========================================================================

      getLayer: (id) => {
        return get().layers[id];
      },

      getLayersByAssetId: (assetId) => {
        return Object.values(get().layers).filter(
          (layer) => layer.assetId === assetId
        );
      },

      // ========================================================================
      // Utilities
      // ========================================================================

      isLayerId: (id) => {
        return id in get().layers;
      },
    }),
    {
      name: 'canal-layer-storage',
      version: 1,
    }
  )
);

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select all layers as an array
 */
export const selectAllLayers = (): Layer[] => {
  return Object.values(useLayerStore.getState().layers);
};

/**
 * Check if an ID refers to a layer
 */
export function isLayerId(id: string): boolean {
  return useLayerStore.getState().isLayerId(id);
}
