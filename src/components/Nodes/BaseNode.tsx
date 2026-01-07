import { useEffect } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import type { CustomNode, BaseNodeData } from '../../types/nodes';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Base handle size in pixels (constant screen size)
const HANDLE_BASE_SIZE = 12;

interface BaseNodeCustomProps {
  children?: React.ReactNode;
  icon?: React.ReactNode;
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
    showInputHandle = true,
    showOutputHandle = true,
    variant = 'default',
  } = props;

  const { zoom } = useViewport();
  const updateNodeInternals = useUpdateNodeInternals();
  const styles = variantStyles[variant];

  // Update handle positions when zoom changes so edges connect correctly
  useEffect(() => {
    updateNodeInternals(props.id);
  }, [zoom, props.id, updateNodeInternals]);

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
          className="!bg-muted-foreground hover:!bg-foreground transition-colors"
          style={{
            width: HANDLE_BASE_SIZE / zoom,
            height: HANDLE_BASE_SIZE / zoom,
            top: -(HANDLE_BASE_SIZE / zoom),
          }}
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
          className="!bg-muted-foreground hover:!bg-foreground transition-colors"
          style={{
            width: HANDLE_BASE_SIZE / zoom,
            height: HANDLE_BASE_SIZE / zoom,
            bottom: -(HANDLE_BASE_SIZE / zoom),
          }}
        />
      )}
    </Card>
  );
}