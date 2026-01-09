import { useEffect, useCallback } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow, addEdge, type NodeProps } from '@xyflow/react';
import type { CustomNode, BaseNodeData } from '../../types/nodes';
import { useConnectionStore } from '../../stores/connectionStore';
import { useGraphStore } from '../../stores/graphStore';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Base handle size in pixels (constant screen size)
const HANDLE_BASE_SIZE = 12;

interface BaseNodeCustomProps {
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

export function BaseNode<T extends BaseNodeData = BaseNodeData>(
    props: NodeProps<CustomNode<T>> & BaseNodeCustomProps
  ) {
  const {
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
  const edges = useGraphStore((state) => state.edges);
  const setEdges = useGraphStore((state) => state.setEdges);

  // Update handle positions when zoom changes so edges connect correctly
  useEffect(() => {
    updateNodeInternals(props.id);
  }, [zoom, props.id, updateNodeInternals]);

  // Handle click on output (source) handle
  const handleSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // If there's an active connection from a target handle, complete the connection
    if (activeConnection?.handleType === 'target' && activeConnection?.nodeId !== props.id) {
      // Remove any existing edge connected to the target handle (single connection per input)
      const filteredEdges = edges.filter(
        (edge) => !(edge.target === activeConnection.nodeId && edge.targetHandle === null)
      );
      // Create edge: this source -> active target
      const newEdges = addEdge({
        source: props.id,
        target: activeConnection.nodeId,
        sourceHandle: null,
        targetHandle: null,
      }, filteredEdges);
      setEdges(newEdges);
      cancelConnection();
      return;
    }

    // If already connecting from this handle, cancel
    if (activeConnection?.nodeId === props.id && activeConnection?.handleType === 'source') {
      cancelConnection();
      return;
    }

    // If connecting from a different source, cancel and start new
    if (activeConnection?.handleType === 'source') {
      cancelConnection();
    }

    // Get node position for the connection line
    const node = getNode(props.id);
    if (!node) return;

    // Calculate handle position (bottom center of node)
    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y + (node.measured?.height ?? 100);

    startConnection({
      nodeId: props.id,
      handleType: 'source',
      handlePosition: Position.Bottom,
      x: handleX,
      y: handleY,
    });
  }, [props.id, activeConnection, startConnection, cancelConnection, getNode, edges, setEdges]);

  // Handle click on input (target) handle
  const handleTargetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // If there's an active connection from a source handle, complete the connection
    if (activeConnection?.handleType === 'source' && activeConnection?.nodeId !== props.id) {
      // Remove any existing edge connected to this target handle (single connection per input)
      const filteredEdges = edges.filter(
        (edge) => !(edge.target === props.id && edge.targetHandle === null)
      );
      // Create edge: active source -> this target
      const newEdges = addEdge({
        source: activeConnection.nodeId,
        target: props.id,
        sourceHandle: null,
        targetHandle: null,
      }, filteredEdges);
      setEdges(newEdges);
      cancelConnection();
      return;
    }

    // If already connecting from this handle, cancel
    if (activeConnection?.nodeId === props.id && activeConnection?.handleType === 'target') {
      cancelConnection();
      return;
    }

    // If connecting from a different target, cancel and start new
    if (activeConnection?.handleType === 'target') {
      cancelConnection();
    }

    // Get node position for the connection line
    const node = getNode(props.id);
    if (!node) return;

    // Calculate handle position (top center of node)
    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y;

    startConnection({
      nodeId: props.id,
      handleType: 'target',
      handlePosition: Position.Top,
      x: handleX,
      y: handleY,
    });
  }, [props.id, activeConnection, startConnection, cancelConnection, getNode, edges, setEdges]);

  // Check if this handle is a valid drop target
  const isValidSourceTarget = activeConnection?.handleType === 'target' && activeConnection?.nodeId !== props.id;
  const isValidTargetTarget = activeConnection?.handleType === 'source' && activeConnection?.nodeId !== props.id;

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