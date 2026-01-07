import { useCallback } from 'react'
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
import { NodeCommandMenu } from './NodeCommandMenu';
import { FileNode, VideoNode, ImageNode, BaseNode } from '../Nodes';
import { ZoomInvariantEdge, ZoomInvariantConnectionLine } from '../Edges';

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

    const handleCommandMenuOpenChange = useCallback((open: boolean) => {
        if (!open) closeCommandMenu();
    }, [closeCommandMenu]);

    const { handleFileDrop, handleFileDragOver } = useDragAndDropFiles();
    const { fitView } = useReactFlow();

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
            const newEdge = addEdge(params, edges);
            setEdges(newEdge);
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
            style={{ width: '100vw', height: '100vh' }}
            onDrop={onDrop}
            onDragOver={handleFileDragOver}
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
            </ReactFlow>
        </div>
    );
}