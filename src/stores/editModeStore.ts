/**
 * Edit Mode Store
 *
 * Manages the state for the node content edit mode, where users can
 * transform assets (video/image/shape) inside a node using react-moveable.
 *
 * Supports two edit modes:
 * 1. Source node edit mode - editing layer.baseTransform
 * 2. Transform operation node edit mode - editing OperationNode.params
 */

import { create } from 'zustand';
import type { BoundingBox } from '../utils/transform-utils';

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
  /** The layer ID being edited (from the node's data) - for source node editing */
  editingLayerId: string | null;
  /** The operation node ID being edited - for transform operation editing */
  editingOperationNodeId: string | null;
  /** Info about the viewer's position relative to the node */
  viewerInfo: ViewerInfo | null;
  /** Whether edit mode is active */
  isEditMode: boolean;

  /** For transform node editing: accumulated content bounds from upstream transforms */
  contentBounds: BoundingBox | null;
  /** For transform node editing: original layer dimensions (for dashed outline) */
  layerDimensions: { width: number; height: number } | null;

  /** Enter edit mode for a source node (editing layer.baseTransform) */
  enterEditMode: (nodeId: string, layerId: string, viewerInfo: ViewerInfo) => void;
  /** Enter edit mode for a transform operation node (editing OperationNode.params) */
  enterTransformEditMode: (
    nodeId: string,
    operationNodeId: string,
    viewerInfo: ViewerInfo,
    contentBounds: BoundingBox,
    layerDimensions: { width: number; height: number }
  ) => void;
  /** Exit edit mode */
  exitEditMode: () => void;
}

export const useEditModeStore = create<EditModeState>((set) => ({
  editingNodeId: null,
  editingLayerId: null,
  editingOperationNodeId: null,
  viewerInfo: null,
  isEditMode: false,
  contentBounds: null,
  layerDimensions: null,

  enterEditMode: (nodeId, layerId, viewerInfo) =>
    set({
      editingNodeId: nodeId,
      editingLayerId: layerId,
      editingOperationNodeId: null,
      viewerInfo,
      isEditMode: true,
      contentBounds: null,
      layerDimensions: null,
    }),

  enterTransformEditMode: (nodeId, operationNodeId, viewerInfo, contentBounds, layerDimensions) =>
    set({
      editingNodeId: nodeId,
      editingLayerId: null,
      editingOperationNodeId: operationNodeId,
      viewerInfo,
      isEditMode: true,
      contentBounds,
      layerDimensions,
    }),

  exitEditMode: () =>
    set({
      editingNodeId: null,
      editingLayerId: null,
      editingOperationNodeId: null,
      viewerInfo: null,
      isEditMode: false,
      contentBounds: null,
      layerDimensions: null,
    }),
}));
