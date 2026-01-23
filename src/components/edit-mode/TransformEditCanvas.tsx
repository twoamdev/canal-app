/**
 * TransformEditCanvas
 *
 * The editing surface for Transform Operation Nodes.
 * Uses the same pattern as EditCanvas but edits TransformParams instead of layer.baseTransform.
 */

import { useRef, useCallback, useLayoutEffect, useState } from 'react';
import Moveable from 'react-moveable';
import type { Viewport } from '@xyflow/react';
import type { TransformParams, OperationNode } from '../../types/scene-graph';
import type { BoundingBox } from '../../utils/transform-utils';

interface TransformEditCanvasProps {
  /** The transform operation node being edited */
  operationNode: OperationNode;
  /** Original layer dimensions (for dashed outline crop boundary) */
  layerDimensions: { width: number; height: number };
  /** Accumulated content bounds from upstream transforms (for Moveable handles) */
  contentBounds: BoundingBox;
  /** Screen position of the viewer */
  viewerScreenX: number;
  viewerScreenY: number;
  /** Screen dimensions of the viewer */
  viewerScreenWidth: number;
  viewerScreenHeight: number;
  /** Current viewport (for zoom/pan) */
  viewport: Viewport;
  /** Callback when transform changes */
  onTransformChange: (params: TransformParams) => void;
  /** Callback to exit edit mode */
  onExit: () => void;
}

export function TransformEditCanvas({
  operationNode,
  layerDimensions,
  contentBounds,
  viewerScreenX,
  viewerScreenY,
  viewerScreenWidth,
  viewerScreenHeight,
  viewport,
  onTransformChange,
  onExit,
}: TransformEditCanvasProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moveableRef = useRef<any>(null);

  // Get the current transform params from the operation node
  const currentParams = operationNode.params as TransformParams;

  // Ensure params have defaults
  const safeParams: TransformParams = {
    position: currentParams?.position ?? { x: 0, y: 0 },
    scale: currentParams?.scale ?? { x: 1, y: 1 },
    rotation: currentParams?.rotation ?? 0,
    anchorPoint: currentParams?.anchorPoint ?? { x: 0.5, y: 0.5 },
  };

  // Track if we're currently dragging to avoid store updates during drag
  const isDraggingRef = useRef(false);

  // Local transform state for smooth dragging (only update store on drag end)
  const [localParams, setLocalParams] = useState<TransformParams | null>(null);
  // Ref to track latest transform value (avoids stale closure in event handlers)
  const localParamsRef = useRef<TransformParams | null>(null);
  // Ref to store the transform at drag/rotate/scale START (for computing deltas)
  const startParamsRef = useRef<TransformParams | null>(null);

  // Use local params during drag, otherwise use node params
  const activeParams = localParams ?? safeParams;

  // Update Moveable handles when viewport changes or when params reset
  useLayoutEffect(() => {
    if (isDraggingRef.current) return;
    moveableRef.current?.updateRect();
  }, [
    viewport.x,
    viewport.y,
    viewport.zoom,
    safeParams.position.x,
    safeParams.position.y,
    safeParams.scale.x,
    safeParams.scale.y,
    safeParams.rotation,
  ]);

  // Calculate padding to extend around the viewer
  const paddingX = Math.max(viewerScreenWidth * 1.5, 200);
  const paddingY = Math.max(viewerScreenHeight * 1.5, 200);

  // Canvas (overlay) extends around the viewer's position
  const canvasLeft = Math.max(0, viewerScreenX - paddingX);
  const canvasTop = Math.max(0, viewerScreenY - paddingY);
  const canvasRight = Math.min(window.innerWidth, viewerScreenX + viewerScreenWidth + paddingX);
  const canvasBottom = Math.min(window.innerHeight, viewerScreenY + viewerScreenHeight + paddingY);
  const overlayWidth = canvasRight - canvasLeft;
  const overlayHeight = canvasBottom - canvasTop;

  // Handle clicks on the canvas background to exit
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onExit();
      }
    },
    [onExit]
  );

  // Prevent clicks on the content from bubbling up
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Get current transform values
  const displayScaleX = activeParams.scale.x;
  const displayScaleY = activeParams.scale.y;
  const displayRotation = activeParams.rotation;
  const anchorX = activeParams.anchorPoint.x;
  const anchorY = activeParams.anchorPoint.y;

  // Calculate the ACTUAL canvas dimensions (expanded to fit all content)
  // This matches the logic in useChainRenderer's applyBaseTransform
  const minX = Math.min(0, contentBounds.x);
  const minY = Math.min(0, contentBounds.y);
  const maxX = Math.max(layerDimensions.width, contentBounds.x + contentBounds.width);
  const expandedCanvasWidth = maxX - minX;
  // Note: we use width for uniform scaling (aspect ratio is preserved by the viewer)

  // Where the layer origin (0,0) sits within the expanded canvas
  const layerOriginInCanvas = { x: -minX, y: -minY };

  // Scale factor: viewer screen size to expanded canvas size
  // The viewer shows the full expanded canvas, so we scale based on that
  const scaleToScreen = viewerScreenWidth / expandedCanvasWidth;

  // Position of the layer bounds (dashed outline) within the viewer
  // The layer bounds start at layerOriginInCanvas in the expanded canvas
  const layerBoundsScreenX = layerOriginInCanvas.x * scaleToScreen;
  const layerBoundsScreenY = layerOriginInCanvas.y * scaleToScreen;
  const layerBoundsScreenWidth = layerDimensions.width * scaleToScreen;
  const layerBoundsScreenHeight = layerDimensions.height * scaleToScreen;

  // Content position within the viewer
  // Content starts at contentBounds.x/y in layer space, which is at
  // (layerOriginInCanvas + contentBounds.x/y) in expanded canvas space
  const contentScreenX = (layerOriginInCanvas.x + contentBounds.x) * scaleToScreen;
  const contentScreenY = (layerOriginInCanvas.y + contentBounds.y) * scaleToScreen;
  const contentScreenWidth = contentBounds.width * scaleToScreen;
  const contentScreenHeight = contentBounds.height * scaleToScreen;

  // Transform position offset (this node's transform, applied on top of content)
  const displayX = activeParams.position.x * scaleToScreen;
  const displayY = activeParams.position.y * scaleToScreen;

  return (
    <div
      onClick={handleCanvasClick}
      className="absolute bg-transparent overflow-hidden"
      style={{
        left: canvasLeft,
        top: canvasTop,
        width: overlayWidth,
        height: overlayHeight,
      }}
    >
      {/* Layer bounds indicator (dashed outline) - the crop boundary */}
      {/* This shows the original layer dimensions within the expanded viewer */}
      <div
        className="absolute border-2 border-dashed border-white/40 pointer-events-none z-10"
        style={{
          left: viewerScreenX - canvasLeft + layerBoundsScreenX,
          top: viewerScreenY - canvasTop + layerBoundsScreenY,
          width: layerBoundsScreenWidth,
          height: layerBoundsScreenHeight,
        }}
      >
        <div className="absolute -top-6 left-0 text-xs text-white/60 whitespace-nowrap">
          Layer Bounds (Crop Area)
        </div>
      </div>

      {/* Transformable content - sized to content bounds (accumulated transforms) */}
      <div
        ref={targetRef}
        onClick={handleContentClick}
        className="absolute cursor-move"
        style={{
          // Position: viewer origin + content position in viewer + this node's transform offset
          left: viewerScreenX - canvasLeft + contentScreenX + displayX,
          top: viewerScreenY - canvasTop + contentScreenY + displayY,
          // Size is the content bounds (accumulated transformed area)
          width: contentScreenWidth,
          height: contentScreenHeight,
          transform: `scale(${displayScaleX}, ${displayScaleY}) rotate(${displayRotation}deg)`,
          transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
        }}
      >
        {/* Visual representation of the transform target - shows content bounds */}
        <div className="w-full h-full border-2 border-blue-400 bg-blue-500/20 flex items-center justify-center">
          <span className="text-blue-300 text-sm">Content Bounds</span>
        </div>
      </div>

      {/* React Moveable - same configuration as EditCanvas */}
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
          startParamsRef.current = safeParams;
          localParamsRef.current = safeParams;
          setLocalParams(safeParams);
        }}
        onDrag={({ beforeTranslate }) => {
          if (!startParamsRef.current) return;

          // Convert screen pixels to layer coordinate space
          const deltaX = beforeTranslate[0] / scaleToScreen;
          const deltaY = beforeTranslate[1] / scaleToScreen;

          const updated: TransformParams = {
            ...startParamsRef.current,
            position: {
              x: startParamsRef.current.position.x + deltaX,
              y: startParamsRef.current.position.y + deltaY,
            },
          };
          localParamsRef.current = updated;
          setLocalParams(updated);
        }}
        onDragEnd={() => {
          isDraggingRef.current = false;
          if (localParamsRef.current) {
            onTransformChange(localParamsRef.current);
          }
          startParamsRef.current = null;
          localParamsRef.current = null;
          setLocalParams(null);
        }}
        onRotateStart={() => {
          isDraggingRef.current = true;
          startParamsRef.current = safeParams;
          localParamsRef.current = safeParams;
          setLocalParams(safeParams);
        }}
        onRotate={({ beforeRotate }) => {
          if (!startParamsRef.current) return;

          const updated: TransformParams = {
            ...startParamsRef.current,
            rotation: beforeRotate,
          };
          localParamsRef.current = updated;
          setLocalParams(updated);
        }}
        onRotateEnd={() => {
          isDraggingRef.current = false;
          if (localParamsRef.current) {
            onTransformChange(localParamsRef.current);
          }
          startParamsRef.current = null;
          localParamsRef.current = null;
          setLocalParams(null);
        }}
        onScaleStart={() => {
          isDraggingRef.current = true;
          startParamsRef.current = safeParams;
          localParamsRef.current = safeParams;
          setLocalParams(safeParams);
        }}
        onScale={({ scale }) => {
          if (!startParamsRef.current) return;

          const newScaleX = startParamsRef.current.scale.x * scale[0];
          const newScaleY = startParamsRef.current.scale.y * scale[1];

          const updated: TransformParams = {
            ...startParamsRef.current,
            scale: { x: newScaleX, y: newScaleY },
          };
          localParamsRef.current = updated;
          setLocalParams(updated);
        }}
        onScaleEnd={() => {
          isDraggingRef.current = false;
          if (localParamsRef.current) {
            onTransformChange(localParamsRef.current);
          }
          startParamsRef.current = null;
          localParamsRef.current = null;
          setLocalParams(null);
        }}
      />
    </div>
  );
}
