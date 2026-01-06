import { useCallback } from 'react';
import { BaseNode } from './BaseNode';
import type { NodeProps } from '@xyflow/react';
import type { FileNode, ExtractedFramesInfo } from '../../types/nodes';
import { FrameScrubber } from '../video/FrameScrubber';
import { useGraphStore } from '../../stores/graphStore';


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

    const fileIcon = (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
        </svg>
    );

    return (
        <BaseNode
            {...props}
            icon={fileIcon}
            variant="blue"
        >
            <div className="text-xs text-gray-500 space-y-2">
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