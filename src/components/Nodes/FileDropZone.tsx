import { useCallback, useRef, useState } from 'react';
import { opfsManager } from '../../utils/opfs';
import { useGraphStore } from '../../stores/graphStore';
import { getNodeTypeForMimeType } from '../../types/nodes';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileDropZoneProps {
    nodeId: string;
    acceptedTypes?: string[]; // e.g., ['video/*', 'image/*']
    placeholder?: string;
    /** If true, will convert a generic 'file' node to the appropriate type based on MIME */
    convertToSpecificType?: boolean;
}

export function FileDropZone({
    nodeId,
    acceptedTypes = ['*/*'],
    placeholder = 'Drop file or click to select',
    convertToSpecificType = false,
}: FileDropZoneProps) {
  
    const updateNode = useGraphStore((state) => state.updateNode);
    const replaceNodeType = useGraphStore((state) => state.replaceNodeType);
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const acceptString = acceptedTypes.join(',');

    const processFile = useCallback(async (file: File) => {
        // Validate file type
        const isAccepted = acceptedTypes.some(type => {
            if (type === '*/*') return true;
            if (type.endsWith('/*')) {
                const category = type.split('/')[0];
                return file.type.startsWith(category + '/');
            }
            return file.type === type;
        });

        if (!isAccepted) {
            console.error(`File type ${file.type} not accepted. Expected: ${acceptedTypes.join(', ')}`);
            return;
        }

        setIsProcessing(true);
        try {
            // Store file in OPFS
            const opfsPath = await opfsManager.storeFile(file);
            const metadata = await opfsManager.getFileMetadata(opfsPath);

            // Determine if we should convert the node type
            if (convertToSpecificType) {
                const targetType = getNodeTypeForMimeType(file.type);
                // Convert to the appropriate node type
                replaceNodeType(nodeId, targetType, {
                    label: file.name,
                    file: metadata,
                });
            } else {
                // Just update the node data without changing type
                updateNode(nodeId, (node) => ({
                    data: {
                        ...node.data,
                        label: file.name,
                        file: metadata,
                    },
                }));
            }
        } catch (error) {
            console.error('Failed to process file:', error);
        } finally {
            setIsProcessing(false);
        }
    }, [nodeId, updateNode, replaceNodeType, acceptedTypes, convertToSpecificType]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const file = e.dataTransfer.files[0];
        if (file) {
            processFile(file);
        }
    }, [processFile]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleClick = useCallback(() => {
        inputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            processFile(file);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
    }, [processFile]);

    return (
        <div
            className={cn(
                'border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer',
                isDragOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 hover:border-muted-foreground/50',
                isProcessing && 'opacity-50 pointer-events-none'
            )}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleClick}
        >
            <input
                ref={inputRef}
                type="file"
                accept={acceptString}
                onChange={handleFileChange}
                className="hidden"
            />
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload className="w-6 h-6" />
                <span className="text-xs text-center">
                    {isProcessing ? 'Processing...' : placeholder}
                </span>
            </div>
        </div>
    );
}
