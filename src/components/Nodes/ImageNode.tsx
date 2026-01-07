import { useEffect, useState, useRef } from 'react';
import { BaseNode } from './BaseNode';
import { FileDropZone } from './FileDropZone';
import type { NodeProps } from '@xyflow/react';
import type { ImageNode } from '../../types/nodes';
import { opfsManager } from '../../utils/opfs';
import { Image as ImageIcon } from 'lucide-react';

// Supported image types
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

export function ImageNode(props: NodeProps<ImageNode>) {
    const hasFile = !!props.data.file;
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const objectUrlRef = useRef<string | null>(null);

    // Load image from OPFS when file is available
    useEffect(() => {
        if (!hasFile || !props.data.file) {
            // Clean up previous URL
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = null;
            }
            setImageUrl(null);
            setImageDimensions(null);
            return;
        }

        const file = props.data.file;

        // Validate file type
        if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
            setError(`Unsupported image type: ${file.type}. Only PNG and JPG are supported.`);
            return;
        }

        setIsLoading(true);
        setError(null);

        // Load the file from OPFS
        opfsManager.getFile(file.opfsPath)
            .then((opfsFile) => {
                // Clean up previous URL
                if (objectUrlRef.current) {
                    URL.revokeObjectURL(objectUrlRef.current);
                }

                // Create object URL for the image
                const url = URL.createObjectURL(opfsFile);
                objectUrlRef.current = url;

                // Load image to get dimensions
                const img = new window.Image();
                img.onload = () => {
                    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                    setImageUrl(url);
                    setIsLoading(false);
                };
                img.onerror = () => {
                    setError('Failed to load image');
                    setIsLoading(false);
                    URL.revokeObjectURL(url);
                    objectUrlRef.current = null;
                };
                img.src = url;
            })
            .catch((err) => {
                console.error('Failed to load image from OPFS:', err);
                setError('Failed to load image from storage');
                setIsLoading(false);
            });

        // Cleanup on unmount
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = null;
            }
        };
    }, [hasFile, props.data.file]);


    return (
        <BaseNode
            {...props}
            icon={<ImageIcon className="w-5 h-5" />}
            variant="success"
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
                        {imageDimensions && (
                            <div className="flex items-center gap-1">
                                <span className="font-medium">Dimensions:</span>
                                <span>{imageDimensions.width} x {imageDimensions.height}</span>
                            </div>
                        )}
                    </div>

                    {/* Image preview */}
                    {isLoading ? (
                        <div className="bg-muted rounded flex items-center justify-center min-w-[200px] min-h-[150px]">
                            <span className="text-muted-foreground">Loading...</span>
                        </div>
                    ) : error ? (
                        <div className="bg-destructive/10 text-destructive rounded p-2 text-center">
                            {error}
                        </div>
                    ) : imageUrl && imageDimensions ? (
                        <img
                            src={imageUrl}
                            alt={props.data.file!.name}
                            className="rounded"
                            width={imageDimensions.width}
                            height={imageDimensions.height}
                        />
                    ) : null}
                </div>
            ) : (
                <FileDropZone
                    nodeId={props.id}
                    acceptedTypes={['image/png', 'image/jpeg']}
                    placeholder="Drop PNG or JPG image"
                />
            )}
        </BaseNode>
    );
}
