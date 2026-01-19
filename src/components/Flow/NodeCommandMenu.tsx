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
import { createOperationNode, createEmptyNode, type OperationType } from '../../types/scene-graph';
import { CircleDot, Palette, Move, Folder} from 'lucide-react';

// =============================================================================
// Node Registry for Command Menu
// =============================================================================

interface BaseNodeTypeDefinition{
    type: 'source' | 'operation';
    label: string;
    description: string;
    icon: string;
    category: 'source' | 'effect' | 'transform';
}

interface SourceNodeTypeDefinition extends BaseNodeTypeDefinition{
    type: 'source';
    sourceType: 'video' | 'sequence' | 'image' | 'svg';
}

interface OperationNodeTypeDefinition extends BaseNodeTypeDefinition{
    type: 'operation';
    operationType: OperationType;
}

type NodeTypeDefinition = SourceNodeTypeDefinition | OperationNodeTypeDefinition;


const NEW_NODE_REGISTRY: NodeTypeDefinition[] = [
    {
        type: 'source',
        label: 'File',
        description: 'Load media, such as images, videos, and svgs',
        icon: 'Folder',
        category: 'source',
    } as SourceNodeTypeDefinition,
    {
        type: 'operation',
        operationType: 'blur',
        label: 'Blur',
        description: 'Gaussian blur effect',
        icon: 'CircleDot',
        category: 'effect',
    } as OperationNodeTypeDefinition,
    {
        type: 'operation',
        operationType: 'color_correct',
        label: 'Color Correct',
        description: 'Brightness, contrast, saturation, exposure',
        icon: 'Palette',
        category: 'effect',
    } as OperationNodeTypeDefinition,
    {
        type: 'operation',
        operationType: 'transform',
        label: 'Transform',
        description: 'Position, scale, rotation',
        icon: 'Move',
        category: 'transform',
    } as OperationNodeTypeDefinition,
];

// Map icon names to components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    CircleDot,
    Palette,
    Move,
    Folder,
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

        if (nodeDef.type === 'source'){
            const newNode = createEmptyNode(flowPosition);
            addNode(newNode);
        }
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
        source: 'Source Assets',
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

            

                {/* Operation nodes */}
                {Object.entries(nodesByCategory).map(([category, nodes]) => (
                    <CommandGroup key={category} heading={categoryLabels[category]}>
                        {nodes.map((node) => {
                            const IconComponent = iconMap[node.icon] || CircleDot;
                            return (
                                <CommandItem
                                    key={`${node.type}-${node.type === 'operation' ? node.operationType : node.label}`}
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
