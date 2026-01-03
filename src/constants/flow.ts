import { type Node, type Edge } from '@xyflow/react';
const initialNodes: Node[] = [
    { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
    { id: 'n2', position: { x: 0, y: 100 }, data: { label: 'Node 2' } },
  ];
const initialEdges: Edge[] = [];
  
export { initialNodes, initialEdges };