/**
 * Rendered Output Store
 *
 * Stores rendered frame outputs for nodes that act as composite sources.
 * This allows downstream nodes to use upstream composite outputs (like merge).
 */

import { create } from 'zustand';

interface RenderedFrame {
  /** The rendered frame as ImageBitmap */
  bitmap: ImageBitmap;
  /** The frame number this was rendered for */
  frameIndex: number;
  /** Timestamp when this was rendered */
  timestamp: number;
  /** Dimensions */
  width: number;
  height: number;
}

interface RenderedOutputState {
  /** Map of nodeId -> rendered frame */
  outputs: Map<string, RenderedFrame>;

  /** Store a rendered output for a node */
  setOutput: (nodeId: string, bitmap: ImageBitmap, frameIndex: number) => void;

  /** Get a rendered output for a node */
  getOutput: (nodeId: string) => RenderedFrame | undefined;

  /** Check if a node has output for a specific frame */
  hasOutputForFrame: (nodeId: string, frameIndex: number) => boolean;

  /** Clear output for a node */
  clearOutput: (nodeId: string) => void;

  /** Clear all outputs */
  clearAllOutputs: () => void;
}

export const useRenderedOutputStore = create<RenderedOutputState>((set, get) => ({
  outputs: new Map(),

  setOutput: (nodeId, bitmap, frameIndex) => {
    set((state) => {
      const newOutputs = new Map(state.outputs);

      // Close old bitmap if it exists and is different
      const existing = newOutputs.get(nodeId);
      if (existing && existing.bitmap !== bitmap) {
        existing.bitmap.close();
      }

      newOutputs.set(nodeId, {
        bitmap,
        frameIndex,
        timestamp: Date.now(),
        width: bitmap.width,
        height: bitmap.height,
      });

      return { outputs: newOutputs };
    });
  },

  getOutput: (nodeId) => {
    return get().outputs.get(nodeId);
  },

  hasOutputForFrame: (nodeId, frameIndex) => {
    const output = get().outputs.get(nodeId);
    return output?.frameIndex === frameIndex;
  },

  clearOutput: (nodeId) => {
    set((state) => {
      const newOutputs = new Map(state.outputs);
      const existing = newOutputs.get(nodeId);
      if (existing) {
        existing.bitmap.close();
        newOutputs.delete(nodeId);
      }
      return { outputs: newOutputs };
    });
  },

  clearAllOutputs: () => {
    set((state) => {
      // Close all bitmaps
      state.outputs.forEach((output) => {
        output.bitmap.close();
      });
      return { outputs: new Map() };
    });
  },
}));

/**
 * Node types that produce composite outputs (can be used as sources by downstream nodes)
 */
export const COMPOSITE_SOURCE_TYPES = ['merge'];

/**
 * Check if a node type is a composite source
 */
export function isCompositeSource(nodeType: string | undefined): boolean {
  return COMPOSITE_SOURCE_TYPES.includes(nodeType ?? '');
}
