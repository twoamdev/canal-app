import { getBezierPath, useViewport, type ConnectionLineComponentProps } from '@xyflow/react';
import { EDGE_BASE_WIDTH } from './ZoomInvariantEdge';

export function ZoomInvariantConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const { zoom } = useViewport();

  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });

  return (
    <g>
      <path
        d={edgePath}
        fill="none"
        stroke="#b1b1b7"
        strokeWidth={EDGE_BASE_WIDTH / zoom}
        className="animated"
      />
    </g>
  );
}
