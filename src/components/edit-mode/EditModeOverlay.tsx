/**
 * EditModeOverlay
 *
 * Portal-based overlay that appears when editing a node's content.
 * Renders above all React Flow content with a dimmed backdrop.
 * Allows trackpad navigation - the edit canvas follows the node as viewport changes.
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow, useOnViewportChange, type Viewport } from '@xyflow/react';
import { useEditModeStore } from '../../stores/editModeStore';
import { useLayerStore } from '../../stores/layerStore';
import { EditCanvas } from './EditCanvas';

// Zoom sensitivity factor
const ZOOM_SENSITIVITY = 0.01;
const PAN_SENSITIVITY = 1;

export function EditModeOverlay() {
  const { isEditMode, editingNodeId, editingLayerId, viewerInfo, exitEditMode } = useEditModeStore();
  const layer = useLayerStore((s) => (editingLayerId ? s.layers[editingLayerId] : null));
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const { getNode, getViewport, setViewport } = useReactFlow();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Track viewport changes in real-time (fires during animations)
  const [viewport, setViewportState] = useState<Viewport>(() => getViewport());

  useOnViewportChange({
    onChange: (newViewport) => {
      setViewportState(newViewport);
    },
  });

  // Use native event listener with passive: false to allow preventDefault
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const handleWheel = (e: WheelEvent) => {
      // Prevent all default behaviors (browser zoom, scroll, etc.)
      e.preventDefault();
      e.stopPropagation();

      const currentViewport = getViewport();

      // Check if it's a pinch-to-zoom gesture (ctrlKey is set for trackpad pinch)
      if (e.ctrlKey || e.metaKey) {
        // Zoom - pinch gesture or ctrl+scroll
        const zoomDelta = -e.deltaY * ZOOM_SENSITIVITY;
        const newZoom = Math.max(0.1, Math.min(4, currentViewport.zoom * (1 + zoomDelta)));

        // Zoom toward cursor position
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // Calculate new viewport position to zoom toward cursor
        const zoomRatio = newZoom / currentViewport.zoom;
        const newX = mouseX - (mouseX - currentViewport.x) * zoomRatio;
        const newY = mouseY - (mouseY - currentViewport.y) * zoomRatio;

        setViewport({ x: newX, y: newY, zoom: newZoom }, { duration: 0 });
      } else {
        // Pan - two-finger scroll
        const newX = currentViewport.x - e.deltaX * PAN_SENSITIVITY;
        const newY = currentViewport.y - e.deltaY * PAN_SENSITIVITY;

        setViewport({ x: newX, y: newY, zoom: currentViewport.zoom }, { duration: 0 });
      }
    };

    // Add with passive: false to allow preventDefault
    overlay.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      overlay.removeEventListener('wheel', handleWheel);
    };
  }, [isEditMode, getViewport, setViewport]);

  // Don't render if not in edit mode or missing required data
  if (!isEditMode || !editingNodeId || !editingLayerId || !layer || !viewerInfo) {
    return null;
  }

  const node = getNode(editingNodeId);
  if (!node) {
    return null;
  }

  // Calculate current screen position of the node
  const nodeScreenX = node.position.x * viewport.zoom + viewport.x;
  const nodeScreenY = node.position.y * viewport.zoom + viewport.y;

  // Scale the viewer offset based on zoom change from initial
  const zoomRatio = viewport.zoom / viewerInfo.initialZoom;
  const scaledOffsetX = viewerInfo.offsetX * zoomRatio;
  const scaledOffsetY = viewerInfo.offsetY * zoomRatio;
  const scaledWidth = viewerInfo.width * zoomRatio;
  const scaledHeight = viewerInfo.height * zoomRatio;

  // Calculate viewer's current screen position
  const viewerScreenX = nodeScreenX + scaledOffsetX;
  const viewerScreenY = nodeScreenY + scaledOffsetY;

  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-50">
      {/* Backdrop - dims the rest of the canvas */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={exitEditMode}
      />

      {/* Edit Canvas - expanded area around the viewer */}
      <EditCanvas
        layer={layer}
        viewerScreenX={viewerScreenX}
        viewerScreenY={viewerScreenY}
        viewerScreenWidth={scaledWidth}
        viewerScreenHeight={scaledHeight}
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
