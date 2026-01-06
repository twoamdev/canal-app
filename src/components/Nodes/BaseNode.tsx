import { useEffect } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import type { CustomNode, BaseNodeData } from '../../types/nodes';

// Base handle size in pixels (constant screen size)
const HANDLE_BASE_SIZE = 12;

interface BaseNodeCustomProps {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  showInputHandle?: boolean;
  showOutputHandle?: boolean;
  variant?: 'default' | 'blue' | 'green' | 'purple' | 'red';
}

const variantStyles = {
  default: {
    border: 'border-gray-300',
    borderSelected: 'border-gray-500',
    borderHover: 'hover:border-gray-400',
    iconBg: 'bg-gray-100',
    iconText: 'text-gray-600',
  },
  blue: {
    border: 'border-blue-300',
    borderSelected: 'border-blue-500',
    borderHover: 'hover:border-blue-400',
    iconBg: 'bg-blue-100',
    iconText: 'text-blue-600',
  },
  green: {
    border: 'border-green-300',
    borderSelected: 'border-green-500',
    borderHover: 'hover:border-green-400',
    iconBg: 'bg-green-100',
    iconText: 'text-green-600',
  },
  purple: {
    border: 'border-purple-300',
    borderSelected: 'border-purple-500',
    borderHover: 'hover:border-purple-400',
    iconBg: 'bg-purple-100',
    iconText: 'text-purple-600',
  },
  red: {
    border: 'border-red-300',
    borderSelected: 'border-red-500',
    borderHover: 'hover:border-red-400',
    iconBg: 'bg-red-100',
    iconText: 'text-red-600',
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

  const baseClasses = `
    bg-white rounded-lg shadow-md border-2 min-w-[200px] p-4
    transition-all duration-200
    ${selected ? styles.borderSelected : styles.border}
    hover:shadow-lg ${styles.borderHover}
  `;

  return (
    <div className={baseClasses}>
      {/* Input handle on top - positioned outside the node */}
      {showInputHandle && (
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-gray-400 hover:!bg-gray-500"
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
            <div className={`w-8 h-8 ${styles.iconBg} rounded flex items-center justify-center`}>
              <div className={styles.iconText}>
                {icon}
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-gray-800 truncate">
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
          className="!bg-gray-400 hover:!bg-gray-500"
          style={{
            width: HANDLE_BASE_SIZE / zoom,
            height: HANDLE_BASE_SIZE / zoom,
            bottom: -(HANDLE_BASE_SIZE / zoom),
          }}
        />
      )}
    </div>
  );
}