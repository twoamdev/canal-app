import { BaseEdge, getBezierPath, useViewport, type EdgeProps } from '@xyflow/react';

// Base edge stroke width in pixels (constant screen size)
export const EDGE_BASE_WIDTH = 2;

export function ZoomInvariantEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const { zoom } = useViewport();

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        strokeWidth: EDGE_BASE_WIDTH / zoom,
      }}
    />
  );
}
