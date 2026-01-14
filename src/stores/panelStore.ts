import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// =============================================================================
// Constants
// =============================================================================

export const PANEL_MIN_WIDTH = 250;
export const PANEL_MAX_WIDTH = 500;
export const PANEL_DEFAULT_WIDTH = 250;

// =============================================================================
// Types
// =============================================================================

interface PanelState {
  /** Whether the properties panel is open */
  isPropertiesPanelOpen: boolean;

  /** Current width of the properties panel in pixels */
  propertiesPanelWidth: number;

  // Actions
  togglePropertiesPanel: () => void;
  openPropertiesPanel: () => void;
  closePropertiesPanel: () => void;
  setPropertiesPanelWidth: (width: number) => void;
}

// =============================================================================
// Store
// =============================================================================

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      // Initial state - panel open by default
      isPropertiesPanelOpen: true,
      propertiesPanelWidth: PANEL_DEFAULT_WIDTH,

      // Actions
      togglePropertiesPanel: () => {
        set((state) => ({
          isPropertiesPanelOpen: !state.isPropertiesPanelOpen,
        }));
      },

      openPropertiesPanel: () => {
        set({ isPropertiesPanelOpen: true });
      },

      closePropertiesPanel: () => {
        set({ isPropertiesPanelOpen: false });
      },

      setPropertiesPanelWidth: (width) => {
        // Clamp width to min/max bounds
        const clampedWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, width));
        set({ propertiesPanelWidth: clampedWidth });
      },
    }),
    {
      name: 'canal-panel-storage',
      version: 2, // Bumped to reset persisted state
      partialize: (state) => ({
        isPropertiesPanelOpen: state.isPropertiesPanelOpen,
        propertiesPanelWidth: state.propertiesPanelWidth,
      }),
    }
  )
);
