/**
 * EditCanvas
 *
 * The editing surface where users can manipulate asset content
 * using react-moveable handles.
 */

import { useRef, useCallback, useLayoutEffect, useState, memo } from 'react';
import Moveable from 'react-moveable';
import type { Viewport } from '@xyflow/react';
import type { Layer } from '../../types/scene-graph';
import type { Transform } from '../../types/scene-graph';
import { useAssetStore } from '../../stores/assetStore';
import { AssetPreview } from './AssetPreview';

// Memoized asset preview to prevent re-renders during drag
const MemoizedAssetPreview = memo(AssetPreview);

interface EditCanvasProps {
  layer: Layer;
  viewerScreenX: number;
  viewerScreenY: number;
  viewerScreenWidth: number;
  viewerScreenHeight: number;
  viewport: Viewport;
  onTransformChange: (transform: Transform) => void;
  onExit: () => void;
}

export function EditCanvas({
  layer,
  viewerScreenX,
  viewerScreenY,
  viewerScreenWidth,
  viewerScreenHeight,
  viewport,
  onTransformChange,
  onExit,
}: EditCanvasProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moveableRef = useRef<any>(null);
  const asset = useAssetStore((s) => s.assets[layer.assetId]);

  // Track if we're currently dragging to avoid store updates during drag
  const isDraggingRef = useRef(false);

  // Local transform state for smooth dragging (only update store on drag end)
  const [localTransform, setLocalTransform] = useState<Transform | null>(null);
  // Ref to track latest transform value (avoids stale closure in event handlers)
  const localTransformRef = useRef<Transform | null>(null);
  // Ref to store the transform at drag/rotate/scale START (for computing deltas)
  const startTransformRef = useRef<Transform | null>(null);

  // Use local transform during drag, otherwise use layer transform
  const activeTransform = localTransform ?? layer.baseTransform;

  // Update Moveable handles when viewport changes (pan/zoom) or when transform resets
  // useLayoutEffect runs synchronously after DOM updates but before paint,
  // ensuring handles update in the same frame as the content
  useLayoutEffect(() => {
    if (isDraggingRef.current) return;
    moveableRef.current?.updateRect();
  }, [
    viewport.x,
    viewport.y,
    viewport.zoom,
    // Also update handles when layer transform changes (e.g., reset button)
    layer.baseTransform.position.x,
    layer.baseTransform.position.y,
    layer.baseTransform.scale.x,
    layer.baseTransform.scale.y,
    layer.baseTransform.rotation,
  ]);

  // Calculate padding to extend around the viewer
  // This gives room to drag/scale content beyond the layer bounds
  const paddingX = Math.max(viewerScreenWidth * 1.5, 200);
  const paddingY = Math.max(viewerScreenHeight * 1.5, 200);

  // Canvas extends around the viewer's position
  // Clamp so the canvas doesn't go off-screen
  const canvasLeft = Math.max(0, viewerScreenX - paddingX);
  const canvasTop = Math.max(0, viewerScreenY - paddingY);
  const canvasRight = Math.min(window.innerWidth, viewerScreenX + viewerScreenWidth + paddingX);
  const canvasBottom = Math.min(window.innerHeight, viewerScreenY + viewerScreenHeight + paddingY);
  const canvasWidth = canvasRight - canvasLeft;
  const canvasHeight = canvasBottom - canvasTop;

  // Position of the "layer bounds" (dashed outline) within the canvas
  // This should align exactly with where the viewer was on screen
  const layerBoundsLeft = viewerScreenX - canvasLeft;
  const layerBoundsTop = viewerScreenY - canvasTop;

  // Handle clicks on the canvas background (not on content) to exit
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      // Only exit if clicking the canvas background, not the moveable content
      if (e.target === e.currentTarget) {
        onExit();
      }
    },
    [onExit]
  );

  // Prevent clicks on the content from bubbling up to canvas
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Wheel events are handled by the parent EditModeOverlay with a native listener

  if (!asset) {
    return null;
  }

  // Get current transform values, applying viewport scale for display
  // Use activeTransform (local during drag, layer otherwise)
  const displayX = activeTransform.position.x * viewport.zoom;
  const displayY = activeTransform.position.y * viewport.zoom;
  const displayScaleX = activeTransform.scale.x;
  const displayScaleY = activeTransform.scale.y;
  const displayRotation = activeTransform.rotation;
  const anchorX = activeTransform.anchorPoint.x;
  const anchorY = activeTransform.anchorPoint.y;

  return (
    <div
      onClick={handleCanvasClick}
      className="absolute bg-transparent overflow-hidden rounded-sm"
      style={{
        left: canvasLeft,
        top: canvasTop,
        width: canvasWidth,
        height: canvasHeight,
      }}
    >
      {/* Checkerboard background pattern */}
      <div
        className="absolute inset-0 opacity-100 pointer-events-none"
        style={{
          backgroundImage: `
            repeating-conic-gradient(
              #404040 0% 25%,
              #404040 0% 50%
            )
          `,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Layer bounds indicator (dashed outline) - the "crop boundary" */}
      <div
        className="absolute border-1 border-dashed border-white/40 pointer-events-none z-10"
        style={{
          left: layerBoundsLeft,
          top: layerBoundsTop,
          width: viewerScreenWidth,
          height: viewerScreenHeight,
        }}
      >
        {/* Label */}
        <div className="absolute -top-6 left-0 text-xs text-white/60 whitespace-nowrap">
          Frame
        </div>
      </div>

      {/* Transformable content */}
      <div
        ref={targetRef}
        onClick={handleContentClick}
        className="absolute cursor-move"
        style={{
          left: layerBoundsLeft + displayX,
          top: layerBoundsTop + displayY,
          width: viewerScreenWidth,
          height: viewerScreenHeight,
          transform: `scale(${displayScaleX}, ${displayScaleY}) rotate(${displayRotation}deg)`,
          transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
        }}
      >
        <MemoizedAssetPreview asset={asset} />
      </div>

      {/* React Moveable */}
      <Moveable
        ref={moveableRef}
        target={targetRef}
        draggable
        rotatable
        scalable
        keepRatio={false}
        throttleDrag={1}
        throttleRotate={1}
        throttleScale={0.01}
        renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
        rotationPosition="top"
        onDragStart={() => {
          isDraggingRef.current = true;
          // Store the starting transform to compute deltas from
          startTransformRef.current = layer.baseTransform;
          localTransformRef.current = layer.baseTransform;
          setLocalTransform(layer.baseTransform);
        }}
        onDrag={({ beforeTranslate }) => {
          if (!startTransformRef.current) return;

          // beforeTranslate is a DELTA from drag start, so add it to the original position
          const deltaX = beforeTranslate[0] / viewport.zoom;
          const deltaY = beforeTranslate[1] / viewport.zoom;

          const updated = {
            ...startTransformRef.current,
            position: {
              x: startTransformRef.current.position.x + deltaX,
              y: startTransformRef.current.position.y + deltaY,
            },
          };
          localTransformRef.current = updated;
          setLocalTransform(updated);
        }}
        onDragEnd={() => {
          isDraggingRef.current = false;
          // Commit final transform to store (use ref to avoid stale closure)
          if (localTransformRef.current) {
            onTransformChange(localTransformRef.current);
          }
          startTransformRef.current = null;
          localTransformRef.current = null;
          setLocalTransform(null);
        }}
        onRotateStart={() => {
          isDraggingRef.current = true;
          startTransformRef.current = layer.baseTransform;
          localTransformRef.current = layer.baseTransform;
          setLocalTransform(layer.baseTransform);
        }}
        onRotate={({ beforeRotate }) => {
          if (!startTransformRef.current) return;

          // beforeRotate is an absolute rotation value
          const updated = {
            ...startTransformRef.current,
            rotation: beforeRotate,
          };
          localTransformRef.current = updated;
          setLocalTransform(updated);
        }}
        onRotateEnd={() => {
          isDraggingRef.current = false;
          if (localTransformRef.current) {
            onTransformChange(localTransformRef.current);
          }
          startTransformRef.current = null;
          localTransformRef.current = null;
          setLocalTransform(null);
        }}
        onScaleStart={() => {
          isDraggingRef.current = true;
          startTransformRef.current = layer.baseTransform;
          localTransformRef.current = layer.baseTransform;
          setLocalTransform(layer.baseTransform);
        }}
        onScale={({ scale }) => {
          if (!startTransformRef.current) return;

          // Moveable's scale is relative to visual size at drag start,
          // so multiply by our starting scale to get the absolute scale
          const newScaleX = startTransformRef.current.scale.x * scale[0];
          const newScaleY = startTransformRef.current.scale.y * scale[1];

          const updated = {
            ...startTransformRef.current,
            scale: { x: newScaleX, y: newScaleY },
          };
          localTransformRef.current = updated;
          setLocalTransform(updated);
        }}
        onScaleEnd={() => {
          isDraggingRef.current = false;
          if (localTransformRef.current) {
            onTransformChange(localTransformRef.current);
          }
          startTransformRef.current = null;
          localTransformRef.current = null;
          setLocalTransform(null);
        }}
      />

    </div>
  );
}
