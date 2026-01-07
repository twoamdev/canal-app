import { BaseNode } from './BaseNode';
import { FileDropZone } from './FileDropZone';
import type { NodeProps } from '@xyflow/react';
import type { FileNode } from '../../types/nodes';
import { File } from 'lucide-react';

export function FileNode(props: NodeProps<FileNode>) {
    const hasFile = !!props.data.file;

    return (
        <BaseNode
            {...props}
            icon={<File className="w-5 h-5" />}
            variant="default"
        >
            {hasFile ? (
                <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-1">
                        <span className="font-medium">Type:</span>
                        <span>{props.data.file!.type || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="font-medium">Size:</span>
                        <span>{(props.data.file!.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                </div>
            ) : (
                <FileDropZone
                    nodeId={props.id}
                    acceptedTypes={['*/*']}
                    placeholder="Drop any file or click to select"
                    convertToSpecificType={true}
                />
            )}
        </BaseNode>
    );
}
