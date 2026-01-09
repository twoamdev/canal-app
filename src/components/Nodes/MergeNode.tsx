/**
 * Merge Node Component
 *
 * Composites two inputs (bg and fg) with various blend modes.
 * Two input handles at the top center, arranged side by side.
 */

import { useCallback, useRef, useEffect } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MergeNode as MergeNodeType, MergeBlendMode } from '../../types/nodes';
import { useGraphStore } from '../../stores/graphStore';
import { useMergeNodeRenderer } from '../../hooks/useMergeNodeRenderer';
import { useTimelineStore } from '../../stores/timelineStore';

// Handle sizing constants (same as BaseNode)
const HANDLE_BASE_SIZE = 12;
const HANDLE_SPACING = 24; // Space between handle centers

const BLEND_MODE_OPTIONS: { value: MergeBlendMode; label: string }[] = [
  { value: 'over', label: 'Over' },
  { value: 'under', label: 'Under' },
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
];

export function MergeNode(props: NodeProps<MergeNodeType>) {
  const { id, data, selected } = props;
  const { zoom } = useViewport();
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNode = useGraphStore((state) => state.updateNode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRenderedFrameRef = useRef<number>(-1);

  // Timeline
  const currentFrame = useTimelineStore((state) => state.currentFrame);

  // Update handle positions when zoom changes
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // Use merge renderer hook
  const [state, actions] = useMergeNodeRenderer({
    nodeId: id,
    canvasRef,
  });

  // Render when selected or timeline changes
  useEffect(() => {
    if (!state.hasBothInputs) return;

    if (selected || lastRenderedFrameRef.current === -1) {
      actions.renderGlobalFrame(currentFrame);
      lastRenderedFrameRef.current = currentFrame;
    }
  }, [state.hasBothInputs, currentFrame, selected, actions]);

  // Re-render when parameters change
  useEffect(() => {
    if (!state.hasBothInputs) return;
    if (lastRenderedFrameRef.current === -1) return;

    actions.renderGlobalFrame(lastRenderedFrameRef.current);
  }, [data.parameters.blendMode, data.parameters.opacity, state.hasBothInputs, actions]);

  const handleBlendModeChange = useCallback(
    (value: string) => {
      updateNode(id, () => ({
        data: {
          ...data,
          parameters: { ...data.parameters, blendMode: value as MergeBlendMode },
        },
      }));
    },
    [id, data, updateNode]
  );

  const handleOpacityChange = useCallback(
    (value: number[]) => {
      updateNode(id, () => ({
        data: {
          ...data,
          parameters: { ...data.parameters, opacity: value[0] },
        },
      }));
    },
    [id, data, updateNode]
  );

  const handleSize = HANDLE_BASE_SIZE / zoom;
  const spacing = HANDLE_SPACING / zoom;

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? 'ring-foreground' : 'ring-border',
        'hover:shadow-lg'
      )}
    >
      {/* Two input handles at top center, side by side */}
      <Handle
        type="target"
        position={Position.Top}
        id="bg"
        className="!bg-blue-500 hover:!bg-blue-400 transition-colors"
        style={{
          width: handleSize,
          height: handleSize,
          top: -handleSize,
          left: `calc(50% - ${spacing / 2 + handleSize / 2}px)`,
        }}
        title="Background (BG)"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="fg"
        className="!bg-orange-500 hover:!bg-orange-400 transition-colors"
        style={{
          width: handleSize,
          height: handleSize,
          top: -handleSize,
          left: `calc(50% + ${spacing / 2 - handleSize / 2}px)`,
        }}
        title="Foreground (FG)"
      />

      {/* Node content */}
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center bg-muted">
            <Layers className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">{data.label}</p>
            {state.dimensions && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {state.dimensions.width} × {state.dimensions.height}
              </p>
            )}
          </div>
        </div>

        {/* Preview canvas */}
        {state.hasBothInputs && state.dimensions && (
          <div className="relative rounded overflow-hidden bg-black">
            <canvas ref={canvasRef} className="w-full h-auto" />
          </div>
        )}

        {/* Input status */}
        <div className="flex gap-2 text-xs">
          <span
            className={cn(
              'px-2 py-0.5 rounded',
              state.hasBg ? 'bg-blue-500/20 text-blue-400' : 'bg-muted text-muted-foreground'
            )}
          >
            BG {state.hasBg ? '✓' : '—'}
          </span>
          <span
            className={cn(
              'px-2 py-0.5 rounded',
              state.hasFg ? 'bg-orange-500/20 text-orange-400' : 'bg-muted text-muted-foreground'
            )}
          >
            FG {state.hasFg ? '✓' : '—'}
          </span>
        </div>

        {/* Blend mode selector */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Blend Mode</span>
          </div>
          <select
            value={data.parameters.blendMode}
            onChange={(e) => handleBlendModeChange(e.target.value)}
            className="w-full h-8 px-2 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {BLEND_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Opacity slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">FG Opacity</span>
            <span className="tabular-nums">{Math.round(data.parameters.opacity * 100)}%</span>
          </div>
          <Slider
            value={[data.parameters.opacity]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={handleOpacityChange}
          />
        </div>
      </div>

      {/* Output handle at bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground hover:!bg-foreground transition-colors"
        style={{
          width: handleSize,
          height: handleSize,
          bottom: -handleSize,
        }}
      />
    </Card>
  );
}
