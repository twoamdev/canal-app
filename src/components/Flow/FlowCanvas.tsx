import { useCallback } from 'react'
import {
    ReactFlow,
    addEdge,
    SelectionMode,
    type OnConnect,
    Background,
    Controls,
} from '@xyflow/react'
import { useDragAndDropFiles } from '../../hooks/useDragAndDropFiles';
import { useCanvasHotkeys } from '../../hooks/useCanvasHotkeys';
import { useGraphStore } from '../../stores/graphStore';
import { FileNode , BaseNode} from '../Nodes';
import { ZoomInvariantEdge, ZoomInvariantConnectionLine } from '../Edges';

// Component to initialize hotkeys inside ReactFlow context
function CanvasHotkeys() {
    useCanvasHotkeys();
    return null;
}

// Define outside component to prevent recreation on each render
const nodeTypes = {
    file: FileNode,
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
    
    const { handleFileDrop, handleFileDragOver } = useDragAndDropFiles();

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
                panOnScroll
                selectionOnDrag
                panOnDrag={[1, 2]}
                selectionMode={SelectionMode.Partial}
                fitView
                minZoom={0.1}
                maxZoom={4}
            >
                <CanvasHotkeys />
                <Controls />
                <Background />
            </ReactFlow>
        </div>
    );
}