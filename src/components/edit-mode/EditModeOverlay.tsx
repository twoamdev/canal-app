/**
 * EditModeOverlay
 *
 * Portal-based overlay that appears when editing a node's content.
 * Renders above all React Flow content with a dimmed backdrop.
 */

import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { useEditModeStore } from '../../stores/editModeStore';
import { useLayerStore } from '../../stores/layerStore';
import { EditCanvas } from './EditCanvas';

export function EditModeOverlay() {
  const { isEditMode, editingNodeId, editingLayerId, viewerBounds, exitEditMode } = useEditModeStore();
  const layer = useLayerStore((s) => (editingLayerId ? s.layers[editingLayerId] : null));
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const { getViewport } = useReactFlow();

  // Don't render if not in edit mode or missing required data
  if (!isEditMode || !editingNodeId || !editingLayerId || !layer || !viewerBounds) {
    return null;
  }

  const viewport = getViewport();

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop - dims the rest of the canvas */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={exitEditMode}
      />

      {/* Edit Canvas - expanded area around the viewer */}
      <EditCanvas
        layer={layer}
        viewerScreenX={viewerBounds.x}
        viewerScreenY={viewerBounds.y}
        viewerScreenWidth={viewerBounds.width}
        viewerScreenHeight={viewerBounds.height}
        viewport={viewport}
        onTransformChange={(transform) => {
          updateLayer(layer.id, { baseTransform: transform });
        }}
        onExit={exitEditMode}
      />
    </div>,
    document.body
  );
}
