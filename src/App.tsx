import './App.css'
import { useCallback } from 'react'
import {
  ReactFlowProvider,
  ReactFlow,
  addEdge,
  SelectionMode,
  type Node,
  type Edge,
  type OnConnect,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Background,
  Controls,
} from '@xyflow/react'


const initialNodes: Node[] = [
  { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
  { id: 'n2', position: { x: 0, y: 100 }, data: { label: 'Node 2' } },
];
const initialEdges: Edge[] = [];



function DnDFlow() {
  const [nodes, _, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { setNodes, screenToFlowPosition } = useReactFlow();

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      
      const files = Array.from(event.dataTransfer.files);
      
      // Get drop position in screen coordinates
      const screenPosition = {
        x: event.clientX,
        y: event.clientY,
      };
      
      // Convert to flow coordinates
      const flowPosition = screenToFlowPosition(screenPosition);
      
      // Create a node for each dropped file
      files.forEach((file, index) => {
        // Offset multiple files slightly so they don't overlap
        const position = {
          x: flowPosition.x + (index * 50),
          y: flowPosition.y + (index * 50),
        };

        const newNode = {
          id: `file-node-${Date.now()}-${index}`,
          type: 'default',
          position,
          data: {
            label: file.name,
            file: {
              name: file.name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
            },
          },
        };

        setNodes((nodes : Node[]) => nodes.concat(newNode));
      });
    },
    [screenToFlowPosition, setNodes]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <>


        <div style={{ width: '100vw', height: '100vh' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
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
    </>
  );
}


export default () => (
  <ReactFlowProvider>
    <DnDFlow />
  </ReactFlowProvider>
);
