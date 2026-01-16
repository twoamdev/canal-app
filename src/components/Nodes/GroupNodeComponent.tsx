/**
 * GroupNode Component
 *
 * A node that combines multiple layers/groups with z-order control.
 * Displays the composited result of all connected inputs.
 *
 * The first connected source becomes the background (z=0),
 * subsequent connections are layered on top in connection order.
 */

import { useCallback, useRef, useEffect } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import type { GroupNode } from '../../types/scene-graph';
import { useGraphStore } from '../../stores/graphStore';
import { useGroupStore } from '../../stores/groupStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Layers, FolderOpen } from 'lucide-react';
import { AssetViewer, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT, drawCheckerboard } from '../viewers';

// Handle size constant
const HANDLE_BASE_SIZE = 12;

const variantStyles = {
  ring: 'ring-purple-500/30',
  ringSelected: 'ring-purple-500',
  iconBg: 'bg-purple-500/10',
  iconText: 'text-purple-600',
};

interface GroupNodeComponentProps {
  id: string;
  data: GroupNode;
  selected?: boolean;
}

export function GroupNodeComponent(props: GroupNodeComponentProps) {
  const { id, data, selected } = props;
  const { groupId, label } = data;

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Stores
  const group = useGroupStore((s) => s.groups[groupId]);
  const addEdge = useGraphStore((s) => s.addEdge);
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const startConnection = useConnectionStore((s) => s.startConnection);
  const cancelConnection = useConnectionStore((s) => s.cancelConnection);

  // ReactFlow
  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Update handle positions when zoom changes
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // Initialize canvas with checkerboard
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = DEFAULT_VIEWER_WIDTH;
    canvas.height = DEFAULT_VIEWER_HEIGHT;
    drawCheckerboard(ctx, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT);
  }, []);

  // Handle click on input (target) handle
  const handleTargetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id) {
      addEdge({
        id: `edge_${Date.now()}`,
        source: activeConnection.nodeId,
        target: id,
        sourceHandle: null,
        targetHandle: null,
      });
      cancelConnection();
      return;
    }

    if (activeConnection?.nodeId === id && activeConnection?.handleType === 'target') {
      cancelConnection();
      return;
    }

    if (activeConnection?.handleType === 'target') {
      cancelConnection();
    }

    const node = getNode(id);
    if (!node) return;

    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y;

    startConnection({
      nodeId: id,
      handleType: 'target',
      handlePosition: Position.Top,
      x: handleX,
      y: handleY,
    });
  }, [id, activeConnection, startConnection, cancelConnection, getNode, addEdge]);

  // Handle click on output (source) handle
  const handleSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

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

    if (activeConnection?.nodeId === id && activeConnection?.handleType === 'source') {
      cancelConnection();
      return;
    }

    if (activeConnection?.handleType === 'source') {
      cancelConnection();
    }

    const node = getNode(id);
    if (!node) return;

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

  // Check if handles are valid drop targets
  const isValidSourceTarget = activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id;
  const isValidTargetTarget = activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id;

  // Get member count
  const memberCount = group?.memberIds.length ?? 0;

  // Early return if group not found
  if (!group) {
    return (
      <Card className="min-w-[200px] p-4 ring-2 ring-destructive/50">
        <div className="text-center text-muted-foreground py-4">
          <p className="text-sm">Group not found</p>
          <p className="text-xs opacity-60">{groupId}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? variantStyles.ringSelected : variantStyles.ring,
        'hover:shadow-lg'
      )}
    >
      {/* Input handle on top */}
      <Handle
        type="target"
        position={Position.Top}
        className={cn(
          '!bg-muted-foreground hover:!bg-foreground transition-colors cursor-pointer',
          isValidTargetTarget && '!bg-primary !scale-125'
        )}
        style={{
          width: HANDLE_BASE_SIZE / zoom,
          height: HANDLE_BASE_SIZE / zoom,
          top: -(HANDLE_BASE_SIZE / zoom),
        }}
        onClick={handleTargetClick}
      />

      {/* Node content */}
      <div className="flex flex-col gap-2">
        {/* Icon and label header */}
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded flex items-center justify-center', variantStyles.iconBg)}>
            <div className={variantStyles.iconText}>
              {memberCount > 0 ? (
                <Layers className="w-5 h-5" />
              ) : (
                <FolderOpen className="w-5 h-5" />
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">
              {label || group.name || 'Group'}
            </p>
            <p className="text-xs text-muted-foreground">
              {memberCount} {memberCount === 1 ? 'layer' : 'layers'}
            </p>
          </div>
        </div>

        {/* Preview canvas */}
        <AssetViewer
          canvasRef={canvasRef}
          width={DEFAULT_VIEWER_WIDTH}
          height={DEFAULT_VIEWER_HEIGHT}
          isLoading={false}
          isEmpty={memberCount === 0}
          emptyMessage="Connect sources to group"
        />
      </div>

      {/* Output handle on bottom */}
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
