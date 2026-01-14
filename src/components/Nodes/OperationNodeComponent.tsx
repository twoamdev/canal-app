/**
 * OperationNode Component
 *
 * Unified operation node that handles blur, color_correct, and transform operations.
 * Shows preview with effects applied. Parameter controls are in the PropertiesPanel.
 */

import { useCallback, useRef, useEffect } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import type { OperationNode, OperationType } from '../../types/scene-graph';
import { useGraphStore } from '../../stores/graphStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useChainRenderer } from '../../hooks/useChainRenderer';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { CircleDot, Palette, Move, Loader2 } from 'lucide-react';

// Handle size constant
const HANDLE_BASE_SIZE = 12;

// Operation type icons
const OPERATION_ICONS = {
  blur: CircleDot,
  color_correct: Palette,
  transform: Move,
};

// Operation type labels
const OPERATION_LABELS: Record<OperationType, string> = {
  blur: 'Blur',
  color_correct: 'Color Correct',
  transform: 'Transform',
};

const variantStyles = {
  ring: 'ring-border',
  ringSelected: 'ring-foreground',
  iconBg: 'bg-muted',
  iconText: 'text-muted-foreground',
};

interface OperationNodeComponentProps {
  id: string;
  data: OperationNode;
  selected?: boolean;
}

export function OperationNodeComponent(props: OperationNodeComponentProps) {
  const { id, data, selected } = props;
  const { operationType, isEnabled, label } = data;

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Chain renderer for preview
  const { isLoading, error, hasUpstream } = useChainRenderer({
    nodeId: id,
    selected: selected ?? false,
    canvasRef,
  });

  // Stores
  const updateNode = useGraphStore((s) => s.updateNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const startConnection = useConnectionStore((s) => s.startConnection);
  const cancelConnection = useConnectionStore((s) => s.cancelConnection);

  // ReactFlow
  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Get icon
  const IconComponent = OPERATION_ICONS[operationType] ?? CircleDot;

  // Update handle positions when zoom changes
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // Toggle enabled
  const toggleEnabled = useCallback(() => {
    updateNode(id, { isEnabled: !isEnabled });
  }, [id, isEnabled, updateNode]);

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

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? variantStyles.ringSelected : variantStyles.ring,
        'hover:shadow-lg',
        !isEnabled && 'opacity-60'
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
              <IconComponent className="w-5 h-5" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">
              {label || OPERATION_LABELS[operationType]}
            </p>
          </div>
          {/* Enable/disable toggle */}
          <Switch
            checked={isEnabled}
            onCheckedChange={toggleEnabled}
            className="scale-75"
          />
        </div>

        {/* Preview canvas with effect chain applied */}
        <div className="relative rounded overflow-hidden bg-black aspect-video">
          <canvas
            ref={canvasRef}
            className="w-full h-auto"
          />
          {/* Loading state */}
          {isLoading && hasUpstream && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {/* No upstream connection */}
          {!hasUpstream && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60">
              <span className="text-xs">No input connected</span>
            </div>
          )}
          {/* Error state */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-red-400">
              <span className="text-xs">{error}</span>
            </div>
          )}
        </div>
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
