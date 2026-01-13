import './App.css'
import { ReactFlowProvider } from '@xyflow/react';
import { FlowCanvas } from './components/flow';
import { TimelineScrubber } from './components/timeline/TimelineScrubber';


export default function App() {
  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <div className="flex-1 relative">
          <FlowCanvas />
        </div>
        <TimelineScrubber />
      </div>
    </ReactFlowProvider>
  );
}
