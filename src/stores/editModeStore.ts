/**
 * Edit Mode Store
 *
 * Manages the state for the node content edit mode, where users can
 * transform assets (video/image/shape) inside a node using react-moveable.
 */

import { create } from 'zustand';

interface ViewerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EditModeState {
  /** The ReactFlow node ID currently being edited */
  editingNodeId: string | null;
  /** The layer ID being edited (from the node's data) */
  editingLayerId: string | null;
  /** The screen bounds of the viewer when edit mode was entered */
  viewerBounds: ViewerBounds | null;
  /** Whether edit mode is active */
  isEditMode: boolean;

  /** Enter edit mode for a specific node/layer */
  enterEditMode: (nodeId: string, layerId: string, viewerBounds: ViewerBounds) => void;
  /** Exit edit mode */
  exitEditMode: () => void;
}

export const useEditModeStore = create<EditModeState>((set) => ({
  editingNodeId: null,
  editingLayerId: null,
  viewerBounds: null,
  isEditMode: false,

  enterEditMode: (nodeId, layerId, viewerBounds) =>
    set({
      editingNodeId: nodeId,
      editingLayerId: layerId,
      viewerBounds,
      isEditMode: true,
    }),

  exitEditMode: () =>
    set({
      editingNodeId: null,
      editingLayerId: null,
      viewerBounds: null,
      isEditMode: false,
    }),
}));
