/**
 * EmptyNode Component
 *
 * A standalone source node placeholder.
 * Displays a checkerboard pattern with no layer/asset.
 */

import { useRef, useEffect } from 'react';
import type { EmptyNode } from '../../types/scene-graph';
import { SquareDashed } from 'lucide-react';
import { drawCheckerboard, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT } from '../viewers';
import { BaseNodeComponent } from './BaseNodeComponent';

interface EmptyNodeComponentProps {
  id: string;
  data: EmptyNode;
  selected?: boolean;
}

export function EmptyNodeComponent({ id, data: _data, selected }: EmptyNodeComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize checkerboard canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = DEFAULT_VIEWER_WIDTH;
    canvas.height = DEFAULT_VIEWER_HEIGHT;
    drawCheckerboard(ctx, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT);
  }, []);

  return (
    <BaseNodeComponent
      id={id}
      selected={selected}
      hasInputHandle={false}
      hasOutputHandle={true}
      icon={SquareDashed}
      label="Empty Source"
      subLabel={`${DEFAULT_VIEWER_WIDTH} × ${DEFAULT_VIEWER_HEIGHT}`}
      variant="default"
    >
      <div className="text-xs text-muted-foreground">
        <div
          className="relative rounded overflow-hidden"
          style={{
            width: DEFAULT_VIEWER_WIDTH,
            height: DEFAULT_VIEWER_HEIGHT,
          }}
        >
          <canvas ref={canvasRef} className="block w-full h-full" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] uppercase font-medium opacity-50 tracking-wider">
              Empty
            </span>
          </div>
        </div>
      </div>
    </BaseNodeComponent>
  );
}
