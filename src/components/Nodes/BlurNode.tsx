import { useCallback, useRef, useEffect } from 'react';
import { BaseNode } from './BaseNode';
import type { NodeProps } from '@xyflow/react';
import type { BlurNode as BlurNodeType } from '../../types/nodes';
import { useGraphStore } from '../../stores/graphStore';
import { useNodeRenderer } from '../../hooks/useNodeRenderer';
import { useTimelineStore } from '../../stores/timelineStore';
import { Slider } from '@/components/ui/slider';
import { CircleDot } from 'lucide-react';

export function BlurNode(props: NodeProps<BlurNodeType>) {
  const updateNode = useGraphStore((state) => state.updateNode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRenderedFrameRef = useRef<number>(-1);

  // Global timeline
  const currentFrame = useTimelineStore((state) => state.currentFrame);

  // Track if this node is selected
  const isSelected = props.selected ?? false;

  const [state, actions] = useNodeRenderer({
    nodeId: props.id,
    canvasRef,
  });

  // Render when:
  // 1. Node becomes selected (sync to current frame)
  // 2. Timeline changes while selected
  // 3. Parameters change while selected
  useEffect(() => {
    if (!state.hasSource || state.frameCount === 0) return;

    // Only render if selected OR if we haven't rendered yet
    if (isSelected || lastRenderedFrameRef.current === -1) {
      // Use renderGlobalFrame which handles time range mapping
      actions.renderGlobalFrame(currentFrame);
      lastRenderedFrameRef.current = currentFrame;
    }
  }, [state.hasSource, state.frameCount, currentFrame, isSelected, props.data.parameters.radius, actions]);

  // Always re-render when parameters change (even if not selected)
  useEffect(() => {
    if (!state.hasSource || state.frameCount === 0) return;
    if (lastRenderedFrameRef.current === -1) return;

    // Re-render with last global frame when params change
    actions.renderGlobalFrame(lastRenderedFrameRef.current);
  }, [props.data.parameters.radius, state.hasSource, state.frameCount, actions]);

  // Handle radius change
  const handleRadiusChange = useCallback(
    (value: number[]) => {
      updateNode(props.id, () => ({
        data: {
          ...props.data,
          parameters: {
            ...props.data.parameters,
            radius: value[0],
          },
        },
      }));
    },
    [props.id, props.data, updateNode]
  );

  const radius = props.data.parameters.radius;

  return (
    <BaseNode
      {...props}
      icon={<CircleDot className="w-5 h-5" />}
      dimensions={state.dimensions}
      variant="default"
    >
      <div className="text-xs text-muted-foreground space-y-3">
        {/* Preview canvas */}
        {state.hasSource && state.dimensions && (
          <div className="relative rounded overflow-hidden bg-black">
            <canvas
              ref={canvasRef}
              className="w-full h-auto"
            />
          </div>
        )}

        {/* No source connected message */}
        {!state.hasSource && (
          <div className="py-4 text-center text-muted-foreground/60 border border-dashed border-muted rounded">
            Connect a video or image
          </div>
        )}

        {/* Radius slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Radius</span>
            <span className="tabular-nums">{radius}px</span>
          </div>
          <Slider
            value={[radius]}
            min={0}
            max={50}
            step={1}
            onValueChange={handleRadiusChange}
          />
        </div>
      </div>
    </BaseNode>
  );
}
