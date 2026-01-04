import { useCallback, useMemo } from 'react'
import {
    ReactFlow,
    addEdge,
    SelectionMode,
    type OnConnect,
    Background,
    Controls,
} from '@xyflow/react'
import { useDragAndDropFiles } from '../../hooks/useDragAndDropFiles';
import { useGraphStore } from '../../stores/graphStore';
import { FileNode , BaseNode} from '../Nodes';

export function FlowCanvas() {
    // Get state and actions from Zustand store
    const nodes = useGraphStore((state) => state.nodes);
    const edges = useGraphStore((state) => state.edges);
    const setEdges = useGraphStore((state) => state.setEdges);
    const onNodesChange = useGraphStore((state) => state.onNodesChange);
    const onEdgesChange = useGraphStore((state) => state.onEdgesChange);
    
    const { handleFileDrop, handleFileDragOver } = useDragAndDropFiles();

    // Register custom node types
    const nodeTypes = useMemo(
        () => ({
            file: FileNode,
            default: BaseNode, // Use BaseNode as default for now
        }),
        []
    );

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
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                panOnScroll
                selectionOnDrag
                panOnDrag={[1, 2]}
                selectionMode={SelectionMode.Partial}
                fitView
            >
                <Controls />
                <Background />
            </ReactFlow>
        </div>
    );
}