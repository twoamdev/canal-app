/**
 * Connection Store
 *
 * Manages the state for click-to-connect behavior.
 * Instead of drag-and-drop, users can click a handle to start connecting,
 * then click another handle to complete the connection.
 */

import { create } from 'zustand';
import { Position } from '@xyflow/react';

export interface ConnectionSource {
  nodeId: string;
  handleType: 'source' | 'target';
  handlePosition: Position;
  // Screen coordinates of the handle
  x: number;
  y: number;
}

interface ConnectionState {
  // The source of the active connection (null if not connecting)
  activeConnection: ConnectionSource | null;
  // Current mouse position in flow coordinates (for drawing the connection line)
  mousePosition: { x: number; y: number } | null;

  // Actions
  startConnection: (source: ConnectionSource) => void;
  updateMousePosition: (x: number, y: number) => void;
  cancelConnection: () => void;
  isConnecting: () => boolean;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  activeConnection: null,
  mousePosition: null,

  startConnection: (source) => {
    set({ activeConnection: source, mousePosition: { x: source.x, y: source.y } });
  },

  updateMousePosition: (x, y) => {
    set({ mousePosition: { x, y } });
  },

  cancelConnection: () => {
    set({ activeConnection: null, mousePosition: null });
  },

  isConnecting: () => {
    return get().activeConnection !== null;
  },
}));
