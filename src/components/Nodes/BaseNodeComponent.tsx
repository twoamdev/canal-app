/**
 * BaseNodeComponent
 *
 * Shared base component for all node types (Source, Operation, Empty).
 * Handles common functionality:
 * - ReactFlow integration (zoom, handles, node internals)
 * - Connection logic (click-to-connect)
 * - Card styling with selection state
 * - Header with icon and label
 * - Handle rendering with zoom-invariant scaling
 */

import { useCallback, useEffect, type ReactNode } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import type { LucideIcon } from 'lucide-react';
import { useGraphStore } from '../../stores/graphStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Handle size constant
const HANDLE_BASE_SIZE = 14;

// Variant styles for different node types
export const NODE_VARIANTS = {
  default: {
    ring: 'ring-border',
    ringSelected: 'ring-foreground',
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
  },
  primary: {
    ring: 'ring-primary/30',
    ringSelected: 'ring-primary',
    iconBg: 'bg-primary/10',
    iconText: 'text-primary',
  },
  success: {
    ring: 'ring-green-500/30',
    ringSelected: 'ring-green-500',
    iconBg: 'bg-green-500/10',
    iconText: 'text-green-600',
  },
  warning: {
    ring: 'ring-yellow-500/30',
    ringSelected: 'ring-yellow-500',
    iconBg: 'bg-yellow-500/10',
    iconText: 'text-yellow-600',
  },
} as const;

export type NodeVariant = keyof typeof NODE_VARIANTS;

export interface BaseNodeComponentProps {
  /** Node ID */
  id: string;
  /** Whether the node is selected */
  selected?: boolean;
  /** Whether node has an input handle (top) */
  hasInputHandle?: boolean;
  /** Whether node has an output handle (bottom) */
  hasOutputHandle?: boolean;
  /** Icon to display in header */
  icon: LucideIcon;
  /** Main label text */
  label: string;
  /** Secondary label (e.g., dimensions) */
  subLabel?: string;
  /** Visual variant for styling */
  variant?: NodeVariant;
  /** Whether the node is enabled (affects opacity) */
  isEnabled?: boolean;
  /** Extra content for header (e.g., toggle switch) */
  headerExtra?: ReactNode;
  /** Click handler for the viewer area (for edit mode) */
  onViewerClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Whether viewer should show pointer cursor */
  viewerClickable?: boolean;
  /** Content to render in the viewer area */
  children: ReactNode;
}

export function BaseNodeComponent({
  id,
  selected = false,
  hasInputHandle = false,
  hasOutputHandle = true,
  //icon: IconComponent,
  label,
  subLabel,
  variant = 'default',
  isEnabled = true,
  headerExtra,
  onViewerClick,
  viewerClickable = false,
  children,
}: BaseNodeComponentProps) {
  // ReactFlow hooks
  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Connection store
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const startConnection = useConnectionStore((s) => s.startConnection);
  const cancelConnection = useConnectionStore((s) => s.cancelConnection);
  const addEdge = useGraphStore((s) => s.addEdge);

  // Get styles for variant
  const styles = NODE_VARIANTS[variant];

  // Update handle positions when zoom changes
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // Handle click on input (target) handle
  const handleTargetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // If there's an active connection from a source handle, complete the connection
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

    // If already connecting from this handle, cancel
    if (activeConnection?.nodeId === id && activeConnection?.handleType === 'target') {
      cancelConnection();
      return;
    }

    // Cancel any existing target connection
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

    // If there's an active connection from a target handle, complete the connection
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

    // If already connecting from this handle, cancel
    if (activeConnection?.nodeId === id && activeConnection?.handleType === 'source') {
      cancelConnection();
      return;
    }

    // Cancel any existing source connection
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
    <div>
<div 
  className="flex items-center absolute bottom-full left-0 origin-bottom-left"
  style={{
    transform: `scale(${1 / zoom})`,
    width: `${zoom * 100}%` 
  }}
>
  {/* Added 'gap-2' for breathing room */}
  <div className="flex items-baseline justify-between w-full gap-2">
    
    {/* 1. min-w-0 is CRITICAL here. It allows the flex item to shrink below its text width */}
    <p className="text-sm font-normal text-muted-foreground truncate min-w-0">
      {label}
    </p>

    {subLabel && selected && (
      // 2. Added truncate + max-w constraint so the sublabel doesn't eat the whole bar
      <p className="text-sm text-muted-foreground tabular-nums bg-zinc-700 rounded-xs px-1 truncate min-w-0 max-w-[50%]">
        {subLabel}
      </p>
    )}
  </div>
  {headerExtra}
</div>
    <Card
      className={cn(
        'min-w-[200px] transition-all duration-200 ring-2',
        selected ? styles.ringSelected : styles.ring,
        'hover:shadow-lg',
        !isEnabled && 'opacity-60'
      )}
    >
      {/* Input handle on top */}
      {hasInputHandle && (
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
      )}

      {/* Node content */}
      <div className="flex flex-col gap-2">
     
        {/* Viewer area */}
        <div
          onClick={onViewerClick}
          className={cn(
            viewerClickable && selected && 'cursor-pointer'
          )}
        >
          {children}
        </div>
      </div>

      {/* Output handle on bottom */}
      {hasOutputHandle && (
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
      )}
    </Card>
    </div>
  );
}
