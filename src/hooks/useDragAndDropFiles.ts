import { useCallback } from 'react';
import { useReactFlow, type XYPosition } from '@xyflow/react';
import { opfsManager } from '../utils/opfs';
import { useGraphStore } from '../stores/graphStore';
import type { FileNode } from '../types/nodes';

export function useDragAndDropFiles() {

  const { screenToFlowPosition } = useReactFlow();
  const addNode = useGraphStore((state) => state.addNode);

  const handleFileDrop = useCallback(
    async (event: React.DragEvent, position: XYPosition) => {
      event.preventDefault();
      
      const files = Array.from(event.dataTransfer.files);
      const flowPosition = screenToFlowPosition(position);

      const nodePromises = files.map(async (file, index) => {
        try {
          //Store the file in OPFS
          const opfsPath = await opfsManager.storeFile(file);
          //Get the metadata of the stored file
          const metadata = await opfsManager.getFileMetadata(opfsPath);

          //Calculate the offset position for the new node
          const offsetPosition = {
            x: flowPosition.x + (index * 50),
            y: flowPosition.y + (index * 50),
          };

          //Create a new file node
          const newNode: FileNode = {
            id: `file-node-${Date.now()}-${index}`,
            type: 'file',
            position: offsetPosition,
            data: {
              label: file.name,
              file: metadata,
            },
          };

          //Add the new node to the graph
          addNode(newNode);

          return newNode;
        } catch (error) {
          console.error(`Failed to process file ${file.name}:`, error);
          return null;
        }
      });

      await Promise.all(nodePromises);
    },
    [screenToFlowPosition, addNode]
  );

  const handleFileDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  return {
    handleFileDrop,
    handleFileDragOver,
  };
}