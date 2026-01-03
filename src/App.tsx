import './App.css'
import { ReactFlowProvider } from '@xyflow/react';
import { FlowCanvas } from './components/Flow';


export default function App() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}
