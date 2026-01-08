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
import { NODE_REGISTRY, type GraphNode } from '../../types/nodes';
import { FileVideo, Image, File, CircleDot, Palette } from 'lucide-react';

// Map icon names to components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    FileVideo,
    Image,
    File,
    CircleDot,
    Palette,
};

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

    const createNode = useCallback((nodeType: string) => {
        // Get viewport center in screen coordinates
        const screenCenterX = window.innerWidth / 2;
        const screenCenterY = window.innerHeight / 2;

        // Convert to flow coordinates
        const flowPosition = screenToFlowPosition({
            x: screenCenterX,
            y: screenCenterY,
        });

        // Find the node definition to get defaultData
        const nodeDef = NODE_REGISTRY.find((n) => n.type === nodeType);
        const defaultData = nodeDef?.defaultData ?? {};

        // Create the node with defaultData
        const newNode: GraphNode = {
            id: `${nodeType}-node-${Date.now()}`,
            type: nodeType,
            position: flowPosition,
            data: {
                label: defaultData.label ?? `New ${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}`,
                ...defaultData,
            },
        } as GraphNode;

        addNode(newNode);
        onOpenChange(false);
    }, [screenToFlowPosition, addNode, onOpenChange]);

    // Group nodes by category
    const nodesByCategory = NODE_REGISTRY.reduce((acc, node) => {
        if (!acc[node.category]) {
            acc[node.category] = [];
        }
        acc[node.category].push(node);
        return acc;
    }, {} as Record<string, typeof NODE_REGISTRY>);

    const categoryLabels: Record<string, string> = {
        input: 'Input Nodes',
        effect: 'Effect Nodes',
        transform: 'Transform Nodes',
        output: 'Output Nodes',
        utility: 'Utility Nodes',
    };

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Add Node"
            description="Search and select a node type to add to the canvas"
        >
            <CommandInput
                placeholder="Search nodes..."
                value={search}
                onValueChange={setSearch}
            />
            <CommandList>
                <CommandEmpty>No nodes found.</CommandEmpty>
                {Object.entries(nodesByCategory).map(([category, nodes]) => (
                    <CommandGroup key={category} heading={categoryLabels[category]}>
                        {nodes.map((node) => {
                            const IconComponent = iconMap[node.icon] || File;
                            return (
                                <CommandItem
                                    key={node.type}
                                    value={`${node.label} ${node.description}`}
                                    onSelect={() => createNode(node.type)}
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
