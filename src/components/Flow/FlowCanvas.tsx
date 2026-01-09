import { useCallback, useEffect } from 'react'
import {
    ReactFlow,
    addEdge,
    SelectionMode,
    useReactFlow,
    type OnConnect,
    type Node,
    Background,
    Controls,
} from '@xyflow/react'
import { useDragAndDropFiles } from '../../hooks/useDragAndDropFiles';
import { useCanvasHotkeys } from '../../hooks/useCanvasHotkeys';
import { useGraphStore } from '../../stores/graphStore';
import { useCommandMenuStore } from '../../stores/commandMenuStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { NodeCommandMenu } from './NodeCommandMenu';
import { FileNode, VideoNode, ImageNode, BlurNode, ColorAdjustNode, MergeNode, BaseNode } from '../Nodes';
import { ZoomInvariantEdge, ZoomInvariantConnectionLine, ClickConnectionLine } from '../Edges';

// Component to initialize hotkeys inside ReactFlow context
function CanvasHotkeys() {
    useCanvasHotkeys();
    return null;
}

// Define outside component to prevent recreation on each render
const nodeTypes = {
    file: FileNode,
    video: VideoNode,
    image: ImageNode,
    blur: BlurNode,
    colorAdjust: ColorAdjustNode,
    merge: MergeNode,
    default: BaseNode,
};

const edgeTypes = {
    zoomInvariant: ZoomInvariantEdge,
};

const defaultEdgeOptions = {
    type: 'zoomInvariant',
};

export function FlowCanvas() {
    // Get state and actions from Zustand store
    const nodes = useGraphStore((state) => state.nodes);
    const edges = useGraphStore((state) => state.edges);
    const setEdges = useGraphStore((state) => state.setEdges);
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
            // Remove any existing edge connected to the same target handle
            // (each input can only have one connection)
            const filteredEdges = edges.filter(
                (edge) => !(edge.target === params.target && edge.targetHandle === params.targetHandle)
            );
            const newEdges = addEdge(params, filteredEdges);
            setEdges(newEdges);
        },
        [edges, setEdges]
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
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={defaultEdgeOptions}
                connectionLineComponent={ZoomInvariantConnectionLine}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
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
                <Controls className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted" />
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