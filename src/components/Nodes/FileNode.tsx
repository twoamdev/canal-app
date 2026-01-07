import { useCallback } from 'react';
import { BaseNode } from './BaseNode';
import type { NodeProps } from '@xyflow/react';
import type { FileNode, ExtractedFramesInfo } from '../../types/nodes';
import { FrameScrubber } from '../video/FrameScrubber';
import { useGraphStore } from '../../stores/graphStore';
import { FileVideo } from 'lucide-react';

export function FileNode(props: NodeProps<FileNode>) {
    const updateNode = useGraphStore((state) => state.updateNode);

    const handleExtracted = useCallback((info: ExtractedFramesInfo) => {
        updateNode(props.id, (node) => ({
            data: {
                ...node.data,
                extractedFrames: info,
            },
        }));
    }, [props.id, updateNode]);

    const handleFrameChange = useCallback((frameIndex: number) => {
        updateNode(props.id, (node) => ({
            data: {
                ...node.data,
                extractedFrames: node.data.extractedFrames
                    ? { ...node.data.extractedFrames, currentFrameIndex: frameIndex }
                    : undefined,
            },
        }));
    }, [props.id, updateNode]);

    return (
        <BaseNode
            {...props}
            icon={<FileVideo className="w-5 h-5" />}
            variant="primary"
        >
            <div className="text-xs text-muted-foreground space-y-2">
                {/* File info */}
                <div className="space-y-1">
                    <div className="flex items-center gap-1">
                        <span className="font-medium">Type:</span>
                        <span>{props.data.file.type || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="font-medium">Size:</span>
                        <span>{(props.data.file.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                </div>

                {/* Frame scrubber */}
                <FrameScrubber
                    nodeId={props.id}
                    file={props.data.file}
                    extractedFrames={props.data.extractedFrames}
                    onExtracted={handleExtracted}
                    onFrameChange={handleFrameChange}
                />
            </div>
        </BaseNode>
    );
}