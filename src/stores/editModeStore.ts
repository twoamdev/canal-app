/**
 * Edit Mode Store
 *
 * Manages the state for the node content edit mode, where users can
 * transform assets (video/image/shape) inside a node using react-moveable.
 */

import { create } from 'zustand';

interface ViewerInfo {
  /** Offset of viewer from node position (in screen pixels at time of click) */
  offsetX: number;
  offsetY: number;
  /** Viewer dimensions (in screen pixels at time of click) */
  width: number;
  height: number;
  /** The viewport zoom level when edit mode was entered */
  initialZoom: number;
}

interface EditModeState {
  /** The ReactFlow node ID currently being edited */
  editingNodeId: string | null;
  /** The layer ID being edited (from the node's data) */
  editingLayerId: string | null;
  /** Info about the viewer's position relative to the node */
  viewerInfo: ViewerInfo | null;
  /** Whether edit mode is active */
  isEditMode: boolean;

  /** Enter edit mode for a specific node/layer */
  enterEditMode: (nodeId: string, layerId: string, viewerInfo: ViewerInfo) => void;
  /** Exit edit mode */
  exitEditMode: () => void;
}

export const useEditModeStore = create<EditModeState>((set) => ({
  editingNodeId: null,
  editingLayerId: null,
  viewerInfo: null,
  isEditMode: false,

  enterEditMode: (nodeId, layerId, viewerInfo) =>
    set({
      editingNodeId: nodeId,
      editingLayerId: layerId,
      viewerInfo,
      isEditMode: true,
    }),

  exitEditMode: () =>
    set({
      editingNodeId: null,
      editingLayerId: null,
      viewerInfo: null,
      isEditMode: false,
    }),
}));
