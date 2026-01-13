import { useEffect, useCallback } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useGraphStore } from '../../stores/graphStore';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Base handle size in pixels (constant screen size)
const HANDLE_BASE_SIZE = 12;

interface BaseNodeData {
  label: string;
  [key: string]: unknown;
}

interface BaseNodeProps {
  id: string;
  data: BaseNodeData;
  selected?: boolean;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  dimensions?: { width: number; height: number } | null;
  showInputHandle?: boolean;
  showOutputHandle?: boolean;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
}

const variantStyles = {
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
  destructive: {
    ring: 'ring-destructive/30',
    ringSelected: 'ring-destructive',
    iconBg: 'bg-destructive/10',
    iconText: 'text-destructive',
  },
};

export function BaseNode(props: BaseNodeProps) {
  const {
    id,
    data,
    selected,
    children,
    icon,
    dimensions,
    showInputHandle = true,
    showOutputHandle = true,
    variant = 'default',
  } = props;

  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const styles = variantStyles[variant];

  // Connection store for click-to-connect
  const activeConnection = useConnectionStore((state) => state.activeConnection);
  const startConnection = useConnectionStore((state) => state.startConnection);
  const cancelConnection = useConnectionStore((state) => state.cancelConnection);

  // Graph store for creating edges
  const addEdgeAction = useGraphStore((state) => state.addEdge);

  // Update handle positions when zoom changes so edges connect correctly
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // Handle click on output (source) handle
  const handleSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // If there's an active connection from a target handle, complete the connection
    if (activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id) {
      // addEdgeAction handles single-connection-per-input internally
      addEdgeAction({
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

    // If connecting from a different source, cancel and start new
    if (activeConnection?.handleType === 'source') {
      cancelConnection();
    }

    // Get node position for the connection line
    const node = getNode(id);
    if (!node) return;

    // Calculate handle position (bottom center of node)
    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y + (node.measured?.height ?? 100);

    startConnection({
      nodeId: id,
      handleType: 'source',
      handlePosition: Position.Bottom,
      x: handleX,
      y: handleY,
    });
  }, [id, activeConnection, startConnection, cancelConnection, getNode, addEdgeAction]);

  // Handle click on input (target) handle
  const handleTargetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // If there's an active connection from a source handle, complete the connection
    if (activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id) {
      // addEdgeAction handles single-connection-per-input internally
      addEdgeAction({
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

    // If connecting from a different target, cancel and start new
    if (activeConnection?.handleType === 'target') {
      cancelConnection();
    }

    // Get node position for the connection line
    const node = getNode(id);
    if (!node) return;

    // Calculate handle position (top center of node)
    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y;

    startConnection({
      nodeId: id,
      handleType: 'target',
      handlePosition: Position.Top,
      x: handleX,
      y: handleY,
    });
  }, [id, activeConnection, startConnection, cancelConnection, getNode, addEdgeAction]);

  // Check if this handle is a valid drop target
  const isValidSourceTarget = activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id;
  const isValidTargetTarget = activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id;

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? styles.ringSelected : styles.ring,
        'hover:shadow-lg'
      )}
    >
      {/* Input handle on top - positioned outside the node */}
      {showInputHandle && (
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
        {/* Icon and label header */}
        <div className="flex items-center gap-2">
          {icon && (
            <div className={cn('w-8 h-8 rounded flex items-center justify-center', styles.iconBg)}>
              <div className={styles.iconText}>
                {icon}
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">
              {data.label}
            </p>
            {dimensions && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {dimensions.width} × {dimensions.height}
              </p>
            )}
          </div>
        </div>

        {/* Custom content (passed as children) */}
        {children}
      </div>

      {/* Output handle on bottom - positioned outside the node */}
      {showOutputHandle && (
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
  );
}