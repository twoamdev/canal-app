import { useCallback } from 'react';
import { BaseNode } from './BaseNode';
import { FileDropZone } from './FileDropZone';
import type { NodeProps } from '@xyflow/react';
import type { VideoNode, ExtractedFramesInfo } from '../../types/nodes';
import { FrameScrubber } from '../video/FrameScrubber';
import { useGraphStore } from '../../stores/graphStore';
import { FileVideo } from 'lucide-react';

export function VideoNode(props: NodeProps<VideoNode>) {
    const updateNode = useGraphStore((state) => state.updateNode);

    const handleExtracted = useCallback((info: ExtractedFramesInfo) => {
        updateNode(props.id, (node) => ({
            data: {
                ...node.data,
                extractedFrames: info,
                // Set default time range if not already set
                timeRange: node.data.timeRange ?? {
                    inFrame: 0,
                    outFrame: info.frameCount,
                    sourceOffset: 0,
                },
                // Set format from native dimensions if not already set
                format: node.data.format ?? {
                    width: info.width,
                    height: info.height,
                },
            },
        }));
    }, [props.id, updateNode]);

    const hasFile = !!props.data.file;

    // Get dimensions from extractedFrames or format override
    const dimensions = props.data.format ?? (props.data.extractedFrames
        ? { width: props.data.extractedFrames.width, height: props.data.extractedFrames.height }
        : null);

   

    return (
        <BaseNode
            {...props}
            icon={<FileVideo className="w-5 h-5" />}
            dimensions={dimensions}
            variant="primary"
            showInputHandle={false}
        >
            {hasFile ? (
                <div className="text-xs text-muted-foreground space-y-2">
                    {/* File info */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-1">
                            <span className="font-medium">Type:</span>
                            <span>{props.data.file!.type || 'Unknown'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="font-medium">Size:</span>
                            <span>{(props.data.file!.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                    </div>

                    {/* Frame preview (synced with global timeline) */}
                    <FrameScrubber
                        file={props.data.file!}
                        extractedFrames={props.data.extractedFrames}
                        timeRange={props.data.timeRange}
                        isSelected={props.selected ?? false}
                        onExtracted={handleExtracted}
                    />
                </div>
            ) : (
                <FileDropZone
                    nodeId={props.id}
                    acceptedTypes={['video/*']}
                    placeholder="Drop video or click to select"
                />
            )}
        </BaseNode>
    );
}
