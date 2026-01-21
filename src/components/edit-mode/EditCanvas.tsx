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

  // Use local transform during drag, otherwise use layer transform
  const activeTransform = localTransform ?? layer.baseTransform;

  // Update Moveable handles when viewport changes (pan/zoom)
  // useLayoutEffect runs synchronously after DOM updates but before paint,
  // ensuring handles update in the same frame as the content
  useLayoutEffect(() => {
    if (isDraggingRef.current) return;
    moveableRef.current?.updateRect();
  }, [viewport.x, viewport.y, viewport.zoom]);

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
      className="absolute bg-transparent overflow-hidden"
      style={{
        left: canvasLeft,
        top: canvasTop,
        width: canvasWidth,
        height: canvasHeight,
      }}
    >
      {/* Checkerboard background pattern */}
      <div
        className="absolute inset-0 opacity-0 pointer-events-none"
        style={{
          backgroundImage: `
            repeating-conic-gradient(
              #808080 0% 25%,
              #404040 0% 50%
            )
          `,
          backgroundSize: '20px 20px',
        }}
      />

      {/* Layer bounds indicator (dashed outline) - the "crop boundary" */}
      <div
        className="absolute border-2 border-dashed border-white/40 pointer-events-none z-10"
        style={{
          left: layerBoundsLeft,
          top: layerBoundsTop,
          width: viewerScreenWidth,
          height: viewerScreenHeight,
        }}
      >
        {/* Label */}
        <div className="absolute -top-6 left-0 text-xs text-white/60 whitespace-nowrap">
          Layer Bounds (Crop Area)
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
          setLocalTransform(layer.baseTransform);
        }}
        onDrag={({ beforeTranslate }) => {
          // Convert screen pixels back to asset-relative pixels
          const assetX = beforeTranslate[0] / viewport.zoom;
          const assetY = beforeTranslate[1] / viewport.zoom;

          // Update local state only (no store update during drag)
          setLocalTransform(prev => prev ? {
            ...prev,
            position: { x: assetX, y: assetY },
          } : null);
        }}
        onDragEnd={() => {
          isDraggingRef.current = false;
          // Commit final transform to store
          if (localTransform) {
            onTransformChange(localTransform);
          }
          setLocalTransform(null);
        }}
        onRotateStart={() => {
          isDraggingRef.current = true;
          setLocalTransform(layer.baseTransform);
        }}
        onRotate={({ beforeRotate }) => {
          setLocalTransform(prev => prev ? {
            ...prev,
            rotation: beforeRotate,
          } : null);
        }}
        onRotateEnd={() => {
          isDraggingRef.current = false;
          if (localTransform) {
            onTransformChange(localTransform);
          }
          setLocalTransform(null);
        }}
        onScaleStart={() => {
          isDraggingRef.current = true;
          setLocalTransform(layer.baseTransform);
        }}
        onScale={({ scale }) => {
          setLocalTransform(prev => prev ? {
            ...prev,
            scale: { x: scale[0], y: scale[1] },
          } : null);
        }}
        onScaleEnd={() => {
          isDraggingRef.current = false;
          if (localTransform) {
            onTransformChange(localTransform);
          }
          setLocalTransform(null);
        }}
      />

    </div>
  );
}
