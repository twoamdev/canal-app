import { useCallback } from 'react';
import { useReactFlow , type Node, type XYPosition} from '@xyflow/react';


export function useDragAndDropFiles() {
    const { setNodes, screenToFlowPosition } = useReactFlow();

    const handleFileDrop = useCallback(
        (event: React.DragEvent, position: XYPosition) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files);
            
            const flowPosition = screenToFlowPosition(position);
            // Create a node for each dropped file
            files.forEach((file, index) => {
                // Offset multiple files slightly so they don't overlap
                const offsetPosition = {
                    x: flowPosition.x + (index * 50),
                    y: flowPosition.y + (index * 50),
                };

                const newNode = {
                    id: `file-node-${Date.now()}-${index}`,
                    type: 'default',
                    position: offsetPosition,
                    data: {
                        label: file.name,
                        file: {
                            name: file.name,
                            size: file.size,
                            type: file.type,
                            lastModified: file.lastModified,
                        },
                    },
                };

                setNodes((nodes: Node[]) => nodes.concat(newNode));
            });
        },
        [screenToFlowPosition, setNodes]
    );

    const handleFileDragOver = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        },
        []
    );

    return {
        handleFileDrop,
        handleFileDragOver,
    };
}
