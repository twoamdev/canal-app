import { useCallback, useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from '@/components/ui/command';
import { useGraphStore } from '../../stores/graphStore';
import { createOperationNode, type OperationType } from '../../types/scene-graph';
import { CircleDot, Palette, Move } from 'lucide-react';

// =============================================================================
// Node Registry for Command Menu
// =============================================================================

interface NodeTypeDefinition {
    type: 'operation';
    operationType: OperationType;
    label: string;
    description: string;
    icon: string;
    category: 'effect' | 'transform';
}

const NEW_NODE_REGISTRY: NodeTypeDefinition[] = [
    // Effect operations
    {
        type: 'operation',
        operationType: 'blur',
        label: 'Blur',
        description: 'Gaussian blur effect',
        icon: 'CircleDot',
        category: 'effect',
    },
    {
        type: 'operation',
        operationType: 'color_correct',
        label: 'Color Correct',
        description: 'Brightness, contrast, saturation, exposure',
        icon: 'Palette',
        category: 'effect',
    },
    // Transform operations (future)
    {
        type: 'operation',
        operationType: 'transform',
        label: 'Transform',
        description: 'Position, scale, rotation',
        icon: 'Move',
        category: 'transform',
    },
];

// Map icon names to components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    CircleDot,
    Palette,
    Move,
};

// =============================================================================
// Component
// =============================================================================

interface NodeCommandMenuProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function NodeCommandMenu({ open, onOpenChange }: NodeCommandMenuProps) {
    const { screenToFlowPosition } = useReactFlow();
    const addNode = useGraphStore((state) => state.addNode);
    const [search, setSearch] = useState('');

    // Reset search when menu opens
    useEffect(() => {
        if (open) {
            setSearch('');
        }
    }, [open]);

    const createNode = useCallback((nodeDef: NodeTypeDefinition) => {
        // Get viewport center in screen coordinates
        const screenCenterX = window.innerWidth / 2;
        const screenCenterY = window.innerHeight / 2;

        // Convert to flow coordinates
        const flowPosition = screenToFlowPosition({
            x: screenCenterX,
            y: screenCenterY,
        });

        // Create the appropriate node type
        if (nodeDef.type === 'operation') {
            const newNode = createOperationNode(nodeDef.operationType, flowPosition);
            addNode(newNode);
        }

        onOpenChange(false);
    }, [screenToFlowPosition, addNode, onOpenChange]);

    // Group nodes by category
    const nodesByCategory = NEW_NODE_REGISTRY.reduce((acc, node) => {
        if (!acc[node.category]) {
            acc[node.category] = [];
        }
        acc[node.category].push(node);
        return acc;
    }, {} as Record<string, NodeTypeDefinition[]>);

    const categoryLabels: Record<string, string> = {
        effect: 'Effect Operations',
        transform: 'Transform Operations',
    };

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Add Node"
            description="Search and select a node type to add to the canvas. Drop files to add source nodes."
        >
            <CommandInput
                placeholder="Search operations..."
                value={search}
                onValueChange={setSearch}
            />
            <CommandList>
                <CommandEmpty>No operations found.</CommandEmpty>

                {/* Note about source nodes */}
                <CommandGroup heading="Source Nodes">
                    <div className="px-2 py-2 text-sm text-muted-foreground">
                        Drop video or image files onto the canvas to create source nodes.
                    </div>
                </CommandGroup>

                {/* Operation nodes */}
                {Object.entries(nodesByCategory).map(([category, nodes]) => (
                    <CommandGroup key={category} heading={categoryLabels[category]}>
                        {nodes.map((node) => {
                            const IconComponent = iconMap[node.icon] || CircleDot;
                            return (
                                <CommandItem
                                    key={`${node.type}-${node.operationType}`}
                                    value={`${node.label} ${node.description}`}
                                    onSelect={() => createNode(node)}
                                >
                                    <IconComponent className="mr-2 h-4 w-4" />
                                    <div className="flex flex-col">
                                        <span>{node.label}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {node.description}
                                        </span>
                                    </div>
                                </CommandItem>
                            );
                        })}
                    </CommandGroup>
                ))}
            </CommandList>
        </CommandDialog>
    );
}
