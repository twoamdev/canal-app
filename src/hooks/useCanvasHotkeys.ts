import { useEffect, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCommandMenuStore } from '../stores/commandMenuStore';
import { useEditModeStore } from '../stores/editModeStore';
import { useAssetStore } from '../stores/assetStore';
import { useCompositionStore } from '../stores/compositionStore';
import { usePanelStore } from '../stores/panelStore';

interface HotkeyAction {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export function useCanvasHotkeys() {
  const { zoomIn, zoomOut, fitView, setViewport, getViewport, getNode } = useReactFlow();
  const openCommandMenu = useCommandMenuStore((state) => state.open);

  // Get helper to find selected node
  const getSelectedNodeId = useCallback(() => {
    const activeCompId = useCompositionStore.getState().activeCompositionId;
    if (!activeCompId) return null;

    const comp = useAssetStore.getState().assets[activeCompId];
    if (!comp || comp.type !== 'composition') return null;

    const selectedNode = Object.values(comp.graph.nodes).find((n) => n.selected);
    return selectedNode?.id ?? null;
  }, []);

  // Define all hotkey actions
  const getHotkeys = useCallback((): HotkeyAction[] => [
    {
      key: 'Tab',
      action: () => openCommandMenu(),
      description: 'Open node command menu',
    },
    {
      key: '`', // Backtick key
      action: () => {
        // Only zoom to selected node when NOT in edit mode
        if (useEditModeStore.getState().isEditMode) {
          return;
        }
        const selectedNodeId = getSelectedNodeId();
        if (!selectedNodeId) return;

        const node = getNode(selectedNodeId);
        if (!node) return;

        // Get node dimensions (use measured if available, fallback to reasonable defaults)
        const nodeWidth = node.measured?.width ?? 200;
        const nodeHeight = node.measured?.height ?? 200;

        // Get panel state
        const { isPropertiesPanelOpen, propertiesPanelWidth } = usePanelStore.getState();

        // Calculate available viewport dimensions
        const panelOffset = isPropertiesPanelOpen ? propertiesPanelWidth : 0;
        const availableWidth = window.innerWidth - panelOffset;
        const availableHeight = window.innerHeight;

        // Calculate zoom to fit node with padding (10% on each side)
        const padding = 0.1;
        const paddedWidth = nodeWidth * (1 + padding * 2);
        const paddedHeight = nodeHeight * (1 + padding * 2);
        const zoomX = availableWidth / paddedWidth;
        const zoomY = availableHeight / paddedHeight;
        const zoom = Math.min(zoomX, zoomY, 4); // Cap at max zoom of 4

        // Calculate node center in flow coordinates
        const nodeCenterX = node.position.x + nodeWidth / 2;
        const nodeCenterY = node.position.y + nodeHeight / 2;

        // Calculate viewport position to center node in available space
        // Available space center is at (availableWidth/2, availableHeight/2)
        const viewportX = availableWidth / 2 - nodeCenterX * zoom;
        const viewportY = availableHeight / 2 - nodeCenterY * zoom;

        setViewport({ x: viewportX, y: viewportY, zoom }, { duration: 150 });
      },
      description: 'Zoom to selected node',
    },
    {
      key: 'Escape',
      action: () => {
        // Exit edit mode if active
        if (useEditModeStore.getState().isEditMode) {
          useEditModeStore.getState().exitEditMode();
        }
      },
      description: 'Exit edit mode',
    },
    {
      key: '=', // + key (without shift)
      action: () => zoomIn({ duration: 200 }),
      description: 'Zoom in',
    },
    {
      key: '+',
      shift: true,
      action: () => zoomIn({ duration: 200 }),
      description: 'Zoom in',
    },
    {
      key: '-',
      action: () => zoomOut({ duration: 200 }),
      description: 'Zoom out',
    },
    {
      key: '0',
      ctrl: true,
      action: () => fitView({ duration: 200 }),
      description: 'Fit view to content',
    },
    {
      key: '1',
      ctrl: true,
      action: () => {
        const { x, y } = getViewport();
        setViewport({ x, y, zoom: 1 }, { duration: 200 });
      },
      description: 'Reset zoom to 100%',
    },
    // Add more hotkeys here as needed
  ], [zoomIn, zoomOut, fitView, setViewport, getViewport, getNode, openCommandMenu, getSelectedNodeId]);

  useEffect(() => {
    const hotkeys = getHotkeys();

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      for (const hotkey of hotkeys) {
        const keyMatch = event.key === hotkey.key;
        const ctrlMatch = hotkey.ctrl ? (event.ctrlKey || event.metaKey) : !(event.ctrlKey || event.metaKey);
        const shiftMatch = hotkey.shift ? event.shiftKey : !event.shiftKey;
        const altMatch = hotkey.alt ? event.altKey : !event.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          hotkey.action();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [getHotkeys]);
}
