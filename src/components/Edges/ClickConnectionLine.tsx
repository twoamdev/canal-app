/**
 * Click Connection Line
 *
 * Renders a connection line that follows the mouse during click-to-connect mode.
 */

import { getBezierPath, Position, useViewport } from '@xyflow/react';
import { useConnectionStore } from '../../stores/connectionStore';
import { EDGE_BASE_WIDTH } from './ZoomInvariantEdge';

export function ClickConnectionLine() {
  const { zoom } = useViewport();
  const activeConnection = useConnectionStore((state) => state.activeConnection);
  const mousePosition = useConnectionStore((state) => state.mousePosition);

  // Don't render if not connecting
  if (!activeConnection || !mousePosition) {
    return null;
  }

  // Determine source and target positions based on handle type
  const isFromSource = activeConnection.handleType === 'source';

  const sourceX = isFromSource ? activeConnection.x : mousePosition.x;
  const sourceY = isFromSource ? activeConnection.y : mousePosition.y;
  const targetX = isFromSource ? mousePosition.x : activeConnection.x;
  const targetY = isFromSource ? mousePosition.y : activeConnection.y;

  const sourcePosition = isFromSource ? Position.Bottom : Position.Top;
  const targetPosition = isFromSource ? Position.Top : Position.Bottom;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <svg
      className="react-flow__edges pointer-events-none"
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        overflow: 'visible',
      }}
    >
      <g className="react-flow__connection">
        <path
          d={edgePath}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={EDGE_BASE_WIDTH / zoom}
          strokeDasharray="5,5"
          className="animated"
        />
      </g>
    </svg>
  );
}
