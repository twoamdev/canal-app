import { useRef, useEffect, useCallback, useState } from 'react';
import type { OPFSFileMetadata } from '../../utils/opfs';
import type { ExtractedFramesInfo, NodeTimeRange } from '../../types/nodes';
import { extractAndStoreFrames } from '../../utils/video-pipeline';
import { loadFrameFromOPFS, getFramePath, type FrameFormat } from '../../utils/frame-storage';
import { useTimelineStore } from '../../stores/timelineStore';
import { Progress } from '@/components/ui/progress';

interface FrameScrubberProps {
    file: OPFSFileMetadata;
    extractedFrames?: ExtractedFramesInfo;
    timeRange?: NodeTimeRange;
    isSelected: boolean;
    onExtracted: (info: ExtractedFramesInfo) => void;
}

export function FrameScrubber({ file, extractedFrames, timeRange, isSelected, onExtracted }: FrameScrubberProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameCountRef = useRef<HTMLSpanElement>(null);
    const lastRenderedFrameRef = useRef<number>(-1);
    const targetFrameRef = useRef<number>(-1); // Track target frame to prevent out-of-order rendering
    const canvasDimensionsSetRef = useRef(false); // Track if canvas dimensions have been set

    // Minimal state for re-renders (only for UI transitions)
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractProgress, setExtractProgress] = useState(0);

    // Use persisted extractedFrames to determine if already extracted
    const isExtracted = !!extractedFrames;

    // Check if file is a video type
    const isVideoFile = file.type.startsWith('video/');

    // Refs for heavy data (no re-renders when these change)
    const frameCacheRef = useRef<Map<number, ImageBitmap>>(new Map());
    const cacheOrderRef = useRef<number[]>([]); // LRU order tracking

    // Max frames to keep in memory (adjust based on frame size)
    const MAX_CACHE_SIZE = 150;

    // Global timeline state
    const currentFrame = useTimelineStore((state) => state.currentFrame);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            frameCacheRef.current.forEach((bitmap) => bitmap.close());
            frameCacheRef.current.clear();
            cacheOrderRef.current = [];
        };
    }, []);

    // Add frame to cache with LRU eviction
    const addToCache = useCallback((frameIndex: number, bitmap: ImageBitmap) => {
        const cache = frameCacheRef.current;
        const order = cacheOrderRef.current;

        // If already in cache, move to end (most recently used)
        const existingIdx = order.indexOf(frameIndex);
        if (existingIdx !== -1) {
            order.splice(existingIdx, 1);
        }
        order.push(frameIndex);

        cache.set(frameIndex, bitmap);

        // Evict oldest entries if over limit
        while (order.length > MAX_CACHE_SIZE) {
            const oldestFrame = order.shift()!;
            const oldBitmap = cache.get(oldestFrame);
            if (oldBitmap) {
                oldBitmap.close();
                cache.delete(oldestFrame);
            }
        }
    }, [MAX_CACHE_SIZE]);

    // Draw a frame to canvas
    const drawFrame = useCallback(async (frameIndex: number) => {
        const canvas = canvasRef.current;
        if (!canvas || !extractedFrames) return;

        // Clamp frame index to valid range for this video
        const clampedIndex = Math.max(0, Math.min(extractedFrames.frameCount - 1, frameIndex));

        // Set this as the target frame (for async ordering)
        targetFrameRef.current = clampedIndex;

        // Set canvas dimensions only once to prevent clearing
        if (!canvasDimensionsSetRef.current ||
            canvas.width !== extractedFrames.width ||
            canvas.height !== extractedFrames.height) {
            canvas.width = extractedFrames.width;
            canvas.height = extractedFrames.height;
            canvasDimensionsSetRef.current = true;
        }

        // Check cache first
        let bitmap = frameCacheRef.current.get(clampedIndex);

        if (!bitmap) {
            const framePath = getFramePath(file.opfsPath, clampedIndex, extractedFrames.format as FrameFormat);
            try {
                bitmap = await loadFrameFromOPFS(framePath);
                addToCache(clampedIndex, bitmap);
            } catch (error) {
                console.error('Failed to load frame:', clampedIndex, error);
                return;
            }
        }

        // Only draw if this is still the target frame (prevents out-of-order rendering)
        if (targetFrameRef.current !== clampedIndex) {
            return;
        }

        // Draw directly to canvas
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        }

        // Update frame counter directly
        if (frameCountRef.current) {
            frameCountRef.current.textContent = `${clampedIndex + 1}/${extractedFrames.frameCount}`;
        }
    }, [file.opfsPath, extractedFrames, addToCache]);

    // Map global timeline frame to source frame using time range
    const mapGlobalToSourceFrame = useCallback((globalFrame: number): number | null => {
        if (!extractedFrames) return null;

        // Get effective time range (use provided or default)
        const range = timeRange ?? {
            inFrame: 0,
            outFrame: extractedFrames.frameCount,
            sourceOffset: 0,
        };

        // Check if global frame is within this node's active range
        if (globalFrame < range.inFrame || globalFrame >= range.outFrame) {
            return null; // Node is inactive at this frame
        }

        // Calculate which source frame to use
        const sourceOffset = range.sourceOffset ?? 0;
        const relativeFrame = globalFrame - range.inFrame;
        const sourceFrame = sourceOffset + relativeFrame;

        // Clamp to available frames
        if (sourceFrame < 0 || sourceFrame >= extractedFrames.frameCount) {
            return null;
        }

        return sourceFrame;
    }, [extractedFrames, timeRange]);

    // Clear canvas to show transparency/black when node is inactive
    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Update frame counter to show inactive state
        if (frameCountRef.current) {
            frameCountRef.current.textContent = '--';
        }
    }, []);

    // Respond to global timeline changes - only render when selected or first time
    useEffect(() => {
        if (!extractedFrames) return;

        const sourceFrame = mapGlobalToSourceFrame(currentFrame);

        // Only render if selected OR if we haven't rendered yet
        if (isSelected || lastRenderedFrameRef.current === -1) {
            if (sourceFrame !== null) {
                drawFrame(sourceFrame);
                lastRenderedFrameRef.current = sourceFrame;
            } else {
                // Node is inactive at this frame - show black/transparent
                clearCanvas();
                lastRenderedFrameRef.current = -1;
            }
        }
    }, [extractedFrames, currentFrame, isSelected, drawFrame, mapGlobalToSourceFrame, clearCanvas]);

    // Handle extraction
    const handleExtract = useCallback(async () => {
        if (isExtracting) return;
        setIsExtracting(true);

        try {
            const result = await extractAndStoreFrames(file, {
                format: 'webp',
                quality: 0.9,
                onProgress: (current, total) => {
                    setExtractProgress(Math.round((current / total) * 100));
                },
            });

            // Save extraction info to node data (persisted)
            onExtracted({
                frameCount: result.frames.length,
                format: result.format,
                width: result.trackInfo.width,
                height: result.trackInfo.height,
                duration: result.trackInfo.duration,
                currentFrameIndex: 0,
            });

            setIsExtracting(false);

        } catch (error) {
            console.error('Failed to extract frames:', error);
            setIsExtracting(false);
        }
    }, [file, isExtracting, onExtracted]);

    // Auto-start extraction for video files on mount
    const hasStartedExtractionRef = useRef(false);
    useEffect(() => {
        if (isVideoFile && !isExtracted && !isExtracting && !hasStartedExtractionRef.current) {
            hasStartedExtractionRef.current = true;
            handleExtract();
        }
    }, [isVideoFile, isExtracted, isExtracting, handleExtract]);

    // Not extracted yet - show extraction progress (auto-started for video files)
    if (!isExtracted) {
        // Non-video files don't support frame extraction
        if (!isVideoFile) {
            return (
                <div className="text-center text-xs text-muted-foreground py-2">
                    Not a video file
                </div>
            );
        }

        // Video file - show extraction progress (auto-started)
        return (
            <div className="space-y-2">
                <div className="text-center text-xs text-muted-foreground">
                    {isExtracting ? `Extracting... ${extractProgress}%` : 'Starting extraction...'}
                </div>
                <Progress value={extractProgress} className="h-2" />
            </div>
        );
    }

    // Show canvas only (timeline controls playback globally)
    return (
        <div className="relative">
            <canvas
                ref={canvasRef}
                className="bg-black rounded w-full"
                style={{ height: 'auto' }}
            />
            <span
                ref={frameCountRef}
                className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded"
            />
        </div>
    );
}
