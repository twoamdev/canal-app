import { useCallback, useEffect } from 'react'
import {
    ReactFlow,
    SelectionMode,
    useReactFlow,
    type OnConnect,
    type Node,
    type OnNodesChange,
    type OnEdgesChange,
    Background,
} from '@xyflow/react'
import { useDragAndDropFiles } from '../../hooks/useDragAndDropFiles';
import { useCanvasHotkeys } from '../../hooks/useCanvasHotkeys';
import { useGraphStore, useGraphNodes, useGraphEdges } from '../../stores/graphStore';
import { initializeCompositionSystem } from '../../stores/compositionStore';
import { useCommandMenuStore } from '../../stores/commandMenuStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { NodeCommandMenu } from './NodeCommandMenu';
import { SourceNodeComponent, OperationNodeComponent, BaseNode } from '../nodes';
import { ZoomInvariantEdge, ZoomInvariantConnectionLine, ClickConnectionLine } from '../edges';

// Component to initialize hotkeys inside ReactFlow context
function CanvasHotkeys() {
    useCanvasHotkeys();
    return null;
}

// Define node types for new architecture
const nodeTypes = {
    source: SourceNodeComponent,
    operation: OperationNodeComponent,
    // Legacy fallback
    default: BaseNode,
};

const edgeTypes = {
    zoomInvariant: ZoomInvariantEdge,
};

const defaultEdgeOptions = {
    type: 'zoomInvariant',
};

export function FlowCanvas() {
    // Initialize composition system on mount
    useEffect(() => {
        initializeCompositionSystem();
    }, []);

    // Get nodes and edges from the new graph hooks
    const nodes = useGraphNodes();
    const edges = useGraphEdges();

    // Get actions from graph store
    const addEdgeAction = useGraphStore((state) => state.addEdge);
    const onNodesChange = useGraphStore((state) => state.onNodesChange);
    const onEdgesChange = useGraphStore((state) => state.onEdgesChange);

    // Command menu state
    const commandMenuOpen = useCommandMenuStore((state) => state.isOpen);
    const closeCommandMenu = useCommandMenuStore((state) => state.close);

    // Click-to-connect state
    const activeConnection = useConnectionStore((state) => state.activeConnection);
    const updateMousePosition = useConnectionStore((state) => state.updateMousePosition);
    const cancelConnection = useConnectionStore((state) => state.cancelConnection);

    const handleCommandMenuOpenChange = useCallback((open: boolean) => {
        if (!open) closeCommandMenu();
    }, [closeCommandMenu]);

    const { handleFileDrop, handleFileDragOver } = useDragAndDropFiles();
    const { fitView, screenToFlowPosition } = useReactFlow();

    // Track mouse position when connecting
    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        if (!activeConnection) return;

        const flowPosition = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
        });
        updateMousePosition(flowPosition.x, flowPosition.y);
    }, [activeConnection, screenToFlowPosition, updateMousePosition]);

    // Cancel connection on background click
    const handlePaneClick = useCallback(() => {
        if (activeConnection) {
            cancelConnection();
        }
    }, [activeConnection, cancelConnection]);

    // Cancel connection on Escape key
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && activeConnection) {
                cancelConnection();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeConnection, cancelConnection]);

    // Double-click on node to zoom and center it
    const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
        fitView({
            nodes: [{ id: node.id }],
            duration: 300,
            padding: 0.25,
        });
    }, [fitView]);

    const onConnect: OnConnect = useCallback(
        (params) => {
            addEdgeAction({
                id: `edge_${Date.now()}`,
                source: params.source,
                target: params.target,
                sourceHandle: params.sourceHandle,
                targetHandle: params.targetHandle,
            });
        },
        [addEdgeAction]
    );

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            const position = {
                x: event.clientX,
                y: event.clientY,
            };
            handleFileDrop(event, position);
        },
        [handleFileDrop]
    );

    return (
        <div
            className="w-full h-full"
            onDrop={onDrop}
            onDragOver={handleFileDragOver}
            onMouseMove={handleMouseMove}
        >
            <ReactFlow
                nodes={nodes as Node[]}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={defaultEdgeOptions}
                connectionLineComponent={ZoomInvariantConnectionLine}
                onNodesChange={onNodesChange as OnNodesChange}
                onEdgesChange={onEdgesChange as OnEdgesChange}
                onConnect={onConnect}
                onNodeDoubleClick={onNodeDoubleClick}
                onPaneClick={handlePaneClick}
                panOnScroll
                selectionOnDrag
                panOnDrag={[1, 2]}
                selectionMode={SelectionMode.Partial}
                fitView
                minZoom={0.1}
                maxZoom={4}
                proOptions={{ hideAttribution: true }}
            >
                <CanvasHotkeys />
               <Background color="hsl(var(--muted-foreground) / 0.3)" gap={20} />
                <NodeCommandMenu
                    open={commandMenuOpen}
                    onOpenChange={handleCommandMenuOpenChange}
                />
                {/* Click-to-connect connection line */}
                {activeConnection && <ClickConnectionLine />}
            </ReactFlow>
        </div>
    );
}
