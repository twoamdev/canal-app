/**
 * EmptyNode Component
 *
 * A standalone source node placeholder.
 * strictly handles visual rendering (checkerboard) and connection logic.
 * Assumes no layer exists yet.
 */

import { useCallback, useRef, useEffect } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import type { EmptyNode } from '../../types/scene-graph';
import { useGraphStore } from '../../stores/graphStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SquareDashed } from 'lucide-react';
import { drawCheckerboard, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT } from '../viewers';

// Handle size constant (Matches SourceNode)
const HANDLE_BASE_SIZE = 12;

const variantStyles = {
  ring: 'ring-border',
  ringSelected: 'ring-foreground',
  iconBg: 'bg-muted',
  iconText: 'text-muted-foreground',
};

interface EmptyNodeComponentProps {
  id: string;
  data: EmptyNode;
  selected?: boolean;
}

export function EmptyNodeComponent(props: EmptyNodeComponentProps) {
  const { id, selected } = props;

  // Stores
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const startConnection = useConnectionStore((s) => s.startConnection);
  const cancelConnection = useConnectionStore((s) => s.cancelConnection);
  const addEdge = useGraphStore((s) => s.addEdge);

  // ReactFlow Hooks
  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Handle Scaling Updates (Same as SourceNode)
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // 2. Initialize Checkerboard Canvas (Same as SourceNode)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Force default dimensions since we have no layer/asset
    canvas.width = DEFAULT_VIEWER_WIDTH;
    canvas.height = DEFAULT_VIEWER_HEIGHT;

    drawCheckerboard(ctx, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT);
  }, []);

  // 3. Handle Click Logic (Exact Copy from SourceNode)
  const handleSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Complete connection if targeting this node
    if (activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id) {
      addEdge({
        id: `edge_${Date.now()}`,
        source: id,
        target: activeConnection.nodeId,
        sourceHandle: null,
        targetHandle: null,
      });
      cancelConnection();
      return;
    }

    // Cancel if clicking own active handle
    if (activeConnection?.nodeId === id && activeConnection?.handleType === 'source') {
      cancelConnection();
      return;
    }

    // Reset if switching modes
    if (activeConnection?.handleType === 'source') {
      cancelConnection();
    }

    const node = getNode(id);
    if (!node) return;

    // Calculate dynamic handle position based on node dimensions
    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y + (node.measured?.height ?? 100);

    startConnection({
      nodeId: id,
      handleType: 'source',
      handlePosition: Position.Bottom,
      x: handleX,
      y: handleY,
    });
  }, [id, activeConnection, startConnection, cancelConnection, getNode, addEdge]);

  // 4. Valid Target Check (Same as SourceNode)
  const isValidSourceTarget = activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id;

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? variantStyles.ringSelected : variantStyles.ring,
        'hover:shadow-lg'
      )}
    >
      {/* Node Content */}
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded flex items-center justify-center', variantStyles.iconBg)}>
            <div className={variantStyles.iconText}>
              <SquareDashed className="w-5 h-5" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">
              Empty Source
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {DEFAULT_VIEWER_WIDTH} × {DEFAULT_VIEWER_HEIGHT}
            </p>
          </div>
        </div>

        {/* Preview Area */}
        <div className="text-xs text-muted-foreground">
          <div 
            className="relative rounded overflow-hidden"
            style={{
              width: DEFAULT_VIEWER_WIDTH,
              height: DEFAULT_VIEWER_HEIGHT,
            }}
          >
            {/* The Checkerboard Canvas */}
            <canvas 
              ref={canvasRef} 
              className="block w-full h-full"
            />
            
            {/* Optional Overlay Label */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
               <span className="text-[10px] uppercase font-medium opacity-50 tracking-wider">
                 Empty
               </span>
            </div>
          </div>
        </div>
      </div>

      {/* Output Handle (Custom Scaled) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          '!bg-muted-foreground hover:!bg-foreground transition-colors cursor-pointer',
          isValidSourceTarget && '!bg-primary !scale-125'
        )}
        style={{
          width: HANDLE_BASE_SIZE / zoom,
          height: HANDLE_BASE_SIZE / zoom,
          bottom: -(HANDLE_BASE_SIZE / zoom),
        }}
        onClick={handleSourceClick}
      />
    </Card>
  );
}