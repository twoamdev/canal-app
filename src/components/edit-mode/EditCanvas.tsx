/**
 * EditCanvas
 *
 * The editing surface where users can manipulate asset content
 * using react-moveable handles.
 */

import { useRef, useCallback } from 'react';
import Moveable from 'react-moveable';
import type { Viewport } from '@xyflow/react';
import type { Layer } from '../../types/scene-graph';
import type { Transform } from '../../types/scene-graph';
import { useAssetStore } from '../../stores/assetStore';
import { AssetPreview } from './AssetPreview';

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
  const asset = useAssetStore((s) => s.assets[layer.assetId]);

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

  if (!asset) {
    return null;
  }

  // Get current transform values, applying viewport scale for display
  const displayX = layer.baseTransform.position.x * viewport.zoom;
  const displayY = layer.baseTransform.position.y * viewport.zoom;
  const displayScaleX = layer.baseTransform.scale.x;
  const displayScaleY = layer.baseTransform.scale.y;
  const displayRotation = layer.baseTransform.rotation;
  const anchorX = layer.baseTransform.anchorPoint.x;
  const anchorY = layer.baseTransform.anchorPoint.y;

  return (
    <div
      onClick={handleCanvasClick}
      className="absolute bg-neutral-900/90 rounded-lg border border-white/10 overflow-hidden"
      style={{
        left: canvasLeft,
        top: canvasTop,
        width: canvasWidth,
        height: canvasHeight,
      }}
    >
      {/* Checkerboard background pattern */}
      <div
        className="absolute inset-0 opacity-20"
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
        <AssetPreview asset={asset} />
      </div>

      {/* React Moveable */}
      <Moveable
        target={targetRef}
        draggable
        rotatable
        scalable
        keepRatio={false}
        throttleDrag={0}
        throttleRotate={0}
        throttleScale={0}
        renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
        rotationPosition="top"
        onDrag={({ beforeTranslate }) => {
          // Convert screen pixels back to asset-relative pixels
          const assetX = beforeTranslate[0] / viewport.zoom;
          const assetY = beforeTranslate[1] / viewport.zoom;

          onTransformChange({
            ...layer.baseTransform,
            position: { x: assetX, y: assetY },
          });
        }}
        onRotate={({ beforeRotate }) => {
          onTransformChange({
            ...layer.baseTransform,
            rotation: beforeRotate,
          });
        }}
        onScale={({ scale }) => {
          onTransformChange({
            ...layer.baseTransform,
            scale: { x: scale[0], y: scale[1] },
          });
        }}
      />

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/50 bg-black/50 px-3 py-1.5 rounded">
        Drag to move | Corner handles to scale | Top handle to rotate | Click
        outside or press Backtick/Escape to exit
      </div>
    </div>
  );
}
