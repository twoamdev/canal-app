import { useEffect, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCommandMenuStore } from '../stores/commandMenuStore';

interface HotkeyAction {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export function useCanvasHotkeys() {
  const { zoomIn, zoomOut, fitView, setViewport, getViewport } = useReactFlow();
  const openCommandMenu = useCommandMenuStore((state) => state.open);

  // Define all hotkey actions
  const getHotkeys = useCallback((): HotkeyAction[] => [
    {
      key: 'Tab',
      action: () => openCommandMenu(),
      description: 'Open node command menu',
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
  ], [zoomIn, zoomOut, fitView, setViewport, getViewport, openCommandMenu]);

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
