import { useCallback } from 'react';
import { useReactFlow, type XYPosition } from '@xyflow/react';
import { useFileImporter } from './useFileImporter';

export function useDragAndDropFiles() {
  const { screenToFlowPosition } = useReactFlow();
  const { importResources, importState } = useFileImporter();

  const handleFileDrop = useCallback(
    async (event: React.DragEvent, position: XYPosition) => {
      event.preventDefault();

      const flowPosition = screenToFlowPosition(position);
      
      // Parse items to separate Files and Entries
      const files: File[] = [];
      const entries: FileSystemEntry[] = [];
      const items = event.dataTransfer.items;

      // 1. Try to get WebKit Entries (for Folders/Sequences)
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const entry = item.webkitGetAsEntry?.();
          
          if (entry) {
            if (entry.isDirectory) {
               entries.push(entry);
            } else if (entry.isFile) {
               // If it's a file entry, get the file object and add to files list
               const file = item.getAsFile();
               if(file) files.push(file);
            }
          } else {
             // Fallback for non-entry items
             const file = item.getAsFile();
             if(file) files.push(file);
          }
        }
      } else {
        // 2. Fallback to standard Files list if items are empty
        const droppedFiles = Array.from(event.dataTransfer.files);
        files.push(...droppedFiles);
      }

      // Delegate to the generic importer
      await importResources({
        files,
        entries,
        basePosition: flowPosition,
      });
    },
    [screenToFlowPosition, importResources]
  );

  const handleFileDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  return {
    handleFileDrop,
    handleFileDragOver,
    state: importState, // Pass the state through so UI remains unchanged
  };
}