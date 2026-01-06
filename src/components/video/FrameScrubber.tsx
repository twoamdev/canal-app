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
}

export function FrameScrubber({ nodeId, file, extractedFrames, onExtracted }: FrameScrubberProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const currentFrameRef = useRef(0);
    const playbackRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef(0);

    const isActive = useFrameStore((state) => state.activeNodeId === nodeId);
    const setActiveNode = useFrameStore((state) => state.setActiveNode);

    // Clear cache when deactivated
    useEffect(() => {
        if (!isActive) {
            // Close all cached ImageBitmaps to free memory
            frameCacheRef.current.forEach((bitmap) => bitmap.close());
            frameCacheRef.current.clear();
        }
    }, [isActive]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            frameCacheRef.current.forEach((bitmap) => bitmap.close());
            frameCacheRef.current.clear();
        };
    }, []);

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
                frameCacheRef.current.set(frameIndex, bitmap);
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
    }, [file.opfsPath, extractedFrames]);

    // Handle slider scrubbing
    const handleScrub = useCallback((e: React.FormEvent<HTMLInputElement>) => {
        const frameIndex = Number((e.target as HTMLInputElement).value);
        currentFrameRef.current = frameIndex;
        drawFrame(frameIndex);
    }, [drawFrame]);

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

    // Stop playback when deactivated
    useEffect(() => {
        if (!isActive && isPlaying) {
            setIsPlaying(false);
        }
    }, [isActive, isPlaying]);

    const togglePlayback = useCallback(() => {
        setIsPlaying((prev) => !prev);
    }, []);

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

    // Setup canvas and draw first frame when becoming active
    useEffect(() => {
        if (!isActive || !extractedFrames) return;

        const canvas = canvasRef.current;
        const slider = sliderRef.current;

        if (canvas) {
            canvas.width = extractedFrames.width;
            canvas.height = extractedFrames.height;
        }

        if (slider) {
            slider.max = String(extractedFrames.frameCount - 1);
            slider.value = '0';
        }

        // Draw first frame
        drawFrame(0);
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

    // Extracted but not active - show thumbnail/activate button
    if (!isActive) {
        return (
            <button
                onClick={handleActivate}
                className="w-full bg-gray-700 text-white px-2 py-1 rounded-md hover:bg-gray-600 text-xs"
            >
                View Frames ({extractedFrames?.frameCount || 0})
            </button>
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
