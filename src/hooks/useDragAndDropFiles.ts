import { useCallback } from 'react';
import { useReactFlow, type Node, type XYPosition } from '@xyflow/react';
import { opfsManager, type OPFSFileMetadata } from '../utils/opfs';

export interface FileNodeData {
  label: string;
  file: OPFSFileMetadata;
  [key: string]: unknown;
}

export function useDragAndDropFiles() {
  const { setNodes, screenToFlowPosition } = useReactFlow();

  const handleFileDrop = useCallback(
    async (event: React.DragEvent, position: XYPosition) => {
      event.preventDefault();
      
      const files = Array.from(event.dataTransfer.files);
      const flowPosition = screenToFlowPosition(position);

      // Process files asynchronously
      const nodePromises = files.map(async (file, index) => {
        try {
          // Store file in OPFS (will auto-init if needed, or throw if not supported)
          const opfsPath = await opfsManager.storeFile(file);
          const metadata = await opfsManager.getFileMetadata(opfsPath);

          // Offset multiple files slightly so they don't overlap
          const offsetPosition = {
            x: flowPosition.x + (index * 50),
            y: flowPosition.y + (index * 50),
          };

          // Create node with OPFS reference
          const newNode: Node<FileNodeData> = {
            id: `file-node-${Date.now()}-${index}`,
            type: 'default', // We'll create custom node types later
            position: offsetPosition,
            data: {
              label: file.name,
              file: metadata,
            },
          };

          return newNode;
        } catch (error) {
          console.error(`Failed to process file ${file.name}:`, error);
          return null;
        }
      });

      // Wait for all files to be processed
      const newNodes = await Promise.all(nodePromises);
      
      // Filter out null values (failed files) and add to graph
      const validNodes = newNodes.filter((node): node is Node<FileNodeData> => node !== null);
      
      if (validNodes.length > 0) {
        setNodes((nodes: Node[]) => nodes.concat(validNodes));
      }

      // Show user feedback if some files failed
      const failedCount = files.length - validNodes.length;
      if (failedCount > 0) {
        console.warn(`${failedCount} file(s) failed to load`);
        // You could add a toast notification here
      }
    },
    [screenToFlowPosition, setNodes]
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