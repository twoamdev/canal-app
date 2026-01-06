import { useRef, useEffect, useCallback, useState } from 'react';
import type { OPFSFileMetadata } from '../../utils/opfs';
import type { ExtractedFramesInfo } from '../../types/nodes';
import { extractAndStoreFrames } from '../../utils/video-pipeline';
import { loadFrameFromOPFS, getFramePath, type FrameFormat } from '../../utils/frame-storage';
import { useFrameStore } from '../../stores/frameStore';

interface FrameScrubberProps {
    nodeId: string;
    file: OPFSFileMetadata;
    extractedFrames?: ExtractedFramesInfo;
    onExtracted: (info: ExtractedFramesInfo) => void;
    onFrameChange: (frameIndex: number) => void;
}

export function FrameScrubber({ nodeId, file, extractedFrames, onExtracted, onFrameChange }: FrameScrubberProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const sliderRef = useRef<HTMLInputElement>(null);
    const frameCountRef = useRef<HTMLSpanElement>(null);
    const progressTextRef = useRef<HTMLSpanElement>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);

    // Minimal state for re-renders (only for UI transitions)
    const [isExtracting, setIsExtracting] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLooping, setIsLooping] = useState(false);

    // Use persisted extractedFrames to determine if already extracted
    const isExtracted = !!extractedFrames;

    // Refs for heavy data (no re-renders when these change)
    const frameCacheRef = useRef<Map<number, ImageBitmap>>(new Map());
    const cacheOrderRef = useRef<number[]>([]); // LRU order tracking
    const currentFrameRef = useRef(extractedFrames?.currentFrameIndex ?? 0);
    const playbackRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef(0);
    const previewBitmapRef = useRef<ImageBitmap | null>(null);

    // Max frames to keep in memory (adjust based on frame size)
    const MAX_CACHE_SIZE = 150;

    const isActive = useFrameStore((state) => state.activeNodeId === nodeId);
    const setActiveNode = useFrameStore((state) => state.setActiveNode);

    // Clear cache when deactivated (but keep preview)
    useEffect(() => {
        if (!isActive) {
            // Close all cached ImageBitmaps to free memory
            frameCacheRef.current.forEach((bitmap) => bitmap.close());
            frameCacheRef.current.clear();
            cacheOrderRef.current = [];
        }
    }, [isActive]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            frameCacheRef.current.forEach((bitmap) => bitmap.close());
            frameCacheRef.current.clear();
            cacheOrderRef.current = [];
            if (previewBitmapRef.current) {
                previewBitmapRef.current.close();
                previewBitmapRef.current = null;
            }
        };
    }, []);

    // Load and draw preview when inactive (shows last viewed frame)
    useEffect(() => {
        if (isActive || !extractedFrames) return;

        const canvas = previewCanvasRef.current;
        if (!canvas) return;

        // Set canvas dimensions
        canvas.width = extractedFrames.width;
        canvas.height = extractedFrames.height;

        const frameIndex = extractedFrames.currentFrameIndex;
        const framePath = getFramePath(file.opfsPath, frameIndex, extractedFrames.format as FrameFormat);

        loadFrameFromOPFS(framePath)
            .then((bitmap) => {
                // Close old preview bitmap
                if (previewBitmapRef.current) {
                    previewBitmapRef.current.close();
                }
                previewBitmapRef.current = bitmap;

                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                }
            })
            .catch((err) => {
                console.error('Failed to load preview frame:', err);
            });
    }, [isActive, extractedFrames, file.opfsPath]);

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

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Check cache first
        let bitmap = frameCacheRef.current.get(frameIndex);

        if (!bitmap) {
            const framePath = getFramePath(file.opfsPath, frameIndex, extractedFrames.format as FrameFormat);
            try {
                bitmap = await loadFrameFromOPFS(framePath);
                addToCache(frameIndex, bitmap);
            } catch (error) {
                console.error('Failed to load frame:', frameIndex, error);
                return;
            }
        }

        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        // Update frame counter directly
        if (frameCountRef.current) {
            frameCountRef.current.textContent = `${frameIndex + 1}/${extractedFrames.frameCount}`;
        }
    }, [file.opfsPath, extractedFrames, addToCache]);

    // Handle slider scrubbing
    const handleScrub = useCallback((e: React.FormEvent<HTMLInputElement>) => {
        const frameIndex = Number((e.target as HTMLInputElement).value);
        currentFrameRef.current = frameIndex;
        drawFrame(frameIndex);
        onFrameChange(frameIndex);
    }, [drawFrame, onFrameChange]);

    // Playback effect
    useEffect(() => {
        if (!isPlaying || !extractedFrames || !isActive) {
            if (playbackRef.current) {
                cancelAnimationFrame(playbackRef.current);
                playbackRef.current = null;
            }
            return;
        }

        const fps = extractedFrames.frameCount / extractedFrames.duration;
        const frameDuration = 1000 / fps;

        const playFrame = (timestamp: number) => {
            if (!lastFrameTimeRef.current) {
                lastFrameTimeRef.current = timestamp;
            }

            const elapsed = timestamp - lastFrameTimeRef.current;

            if (elapsed >= frameDuration) {
                lastFrameTimeRef.current = timestamp - (elapsed % frameDuration);

                let nextFrame = currentFrameRef.current + 1;

                if (nextFrame >= extractedFrames.frameCount) {
                    if (isLooping) {
                        nextFrame = 0;
                    } else {
                        setIsPlaying(false);
                        return;
                    }
                }

                currentFrameRef.current = nextFrame;
                drawFrame(nextFrame);

                // Update slider position
                if (sliderRef.current) {
                    sliderRef.current.value = String(nextFrame);
                }
            }

            playbackRef.current = requestAnimationFrame(playFrame);
        };

        lastFrameTimeRef.current = 0;
        playbackRef.current = requestAnimationFrame(playFrame);

        return () => {
            if (playbackRef.current) {
                cancelAnimationFrame(playbackRef.current);
                playbackRef.current = null;
            }
        };
    }, [isPlaying, isLooping, extractedFrames, isActive, drawFrame]);

    // Track previous active state to detect deactivation
    const wasActiveRef = useRef(isActive);

    // Stop playback and save frame when deactivated
    useEffect(() => {
        if (!isActive && isPlaying) {
            setIsPlaying(false);
        }
        // Save current frame only when transitioning from active to inactive
        if (wasActiveRef.current && !isActive) {
            onFrameChange(currentFrameRef.current);
        }
        wasActiveRef.current = isActive;
    }, [isActive, isPlaying, onFrameChange]);

    const togglePlayback = useCallback(() => {
        // Save frame when pausing (check current state before toggling)
        if (isPlaying) {
            onFrameChange(currentFrameRef.current);
        }
        setIsPlaying((prev) => !prev);
    }, [isPlaying, onFrameChange]);

    const toggleLoop = useCallback(() => {
        setIsLooping((prev) => !prev);
    }, []);

    // Handle extraction
    const handleExtract = useCallback(async () => {
        if (isExtracting) return;
        setIsExtracting(true);

        // Activate this node
        setActiveNode(nodeId);

        try {
            const result = await extractAndStoreFrames(file, {
                format: 'webp',
                quality: 0.9,
                onProgress: (current, total) => {
                    if (progressTextRef.current) {
                        progressTextRef.current.textContent = `${current}/${total}`;
                    }
                    if (progressBarRef.current) {
                        progressBarRef.current.style.width = `${(current / total) * 100}%`;
                    }
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
    }, [file, nodeId, setActiveNode, isExtracting, onExtracted]);

    // Activate this node for scrubbing (if already extracted)
    const handleActivate = useCallback(() => {
        setActiveNode(nodeId);
    }, [nodeId, setActiveNode]);

    // Setup canvas and draw current frame when becoming active
    useEffect(() => {
        if (!isActive || !extractedFrames) return;

        const canvas = canvasRef.current;
        const slider = sliderRef.current;
        const frameIndex = extractedFrames.currentFrameIndex;

        if (canvas) {
            canvas.width = extractedFrames.width;
            canvas.height = extractedFrames.height;
        }

        if (slider) {
            slider.max = String(extractedFrames.frameCount - 1);
            slider.value = String(frameIndex);
        }

        // Update ref and draw the current frame
        currentFrameRef.current = frameIndex;
        drawFrame(frameIndex);
    }, [isActive, extractedFrames, drawFrame]);

    // Not extracted yet - show extract button or progress
    if (!isExtracted) {
        return (
            <div className="space-y-2">
                {isExtracting ? (
                    <div className="space-y-1">
                        <div className="text-center text-xs">
                            Extracting... <span ref={progressTextRef}>0/0</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                ref={progressBarRef}
                                className="bg-blue-500 h-2 rounded-full transition-all"
                                style={{ width: '0%' }}
                            />
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={handleExtract}
                        className="w-full bg-blue-500 text-white px-2 py-1 rounded-md hover:bg-blue-600 active:bg-blue-700 text-xs"
                    >
                        Extract Frames
                    </button>
                )}
            </div>
        );
    }

    // Extracted but not active - show preview with click to activate
    if (!isActive) {
        return (
            <div className="space-y-2">
                <div
                    className="relative cursor-pointer group"
                    onClick={handleActivate}
                >
                    <canvas
                        ref={previewCanvasRef}
                        className="bg-black rounded w-full"
                        style={{ height: 'auto' }}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/70 px-2 py-1 rounded transition-opacity">
                            Click to edit
                        </span>
                    </div>
                    <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                        {(extractedFrames?.currentFrameIndex ?? 0) + 1}/{extractedFrames?.frameCount || 0}
                    </span>
                </div>
            </div>
        );
    }

    // Active - show canvas and scrubber
    return (
        <div className="space-y-2">
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
            <input
                ref={sliderRef}
                type="range"
                min={0}
                max={0}
                defaultValue={0}
                onInput={handleScrub}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex items-center gap-2">
                <button
                    onClick={togglePlayback}
                    className="flex-1 bg-blue-500 text-white px-2 py-1 rounded-md hover:bg-blue-600 active:bg-blue-700 text-xs flex items-center justify-center gap-1"
                >
                    {isPlaying ? (
                        <>
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                <rect x="6" y="4" width="4" height="16" />
                                <rect x="14" y="4" width="4" height="16" />
                            </svg>
                            Pause
                        </>
                    ) : (
                        <>
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            Play
                        </>
                    )}
                </button>
                <button
                    onClick={toggleLoop}
                    className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 ${
                        isLooping
                            ? 'bg-green-500 text-white hover:bg-green-600'
                            : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                    }`}
                    title={isLooping ? 'Loop enabled' : 'Loop disabled'}
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                    </svg>
                </button>
            </div>
        </div>
    );
}
