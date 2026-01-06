import { create } from 'zustand';

interface FrameStore {
    // Only one node can be actively scrubbing at a time
    activeNodeId: string | null;
    setActiveNode: (nodeId: string | null) => void;
}

export const useFrameStore = create<FrameStore>()((set) => ({
    activeNodeId: null,
    setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),
}));
