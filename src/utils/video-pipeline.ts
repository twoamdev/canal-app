import type { OPFSFileMetadata } from './opfs';
import { demuxVideo, type DemuxerResult } from './video-demuxer';
import { createVideoDecoder } from './video-decoder';
import {
    saveFrameToOPFS,
    type FrameFormat,
    type StoredFrameInfo,
} from './frame-storage';

export type ProcessFrameCallback = (frame: VideoFrame, index: number) => void | Promise<void>;

export interface ProcessVideoResult {
    trackInfo: DemuxerResult['trackInfo'];
    totalFrames: number;
}

export interface ExtractFramesResult {
    trackInfo: DemuxerResult['trackInfo'];
    frames: StoredFrameInfo[];
    format: FrameFormat;
}

export interface ExtractFramesOptions {
    format?: FrameFormat;
    quality?: number;
    onProgress?: (current: number, total: number) => void;
    maxConcurrency?: number; // Max frames to process simultaneously (default: 4)
}

/**
 * Process a video file from OPFS: demux and decode in one step
 * @param file - The OPFS file metadata
 * @param onFrame - Callback for each decoded VideoFrame (remember to call frame.close())
 * @returns Promise with track info and total frame count
 */
export async function processVideo(
    file: OPFSFileMetadata,
    onFrame: ProcessFrameCallback
): Promise<ProcessVideoResult> {
    // Buffer chunks during demux since we need the config before creating decoder
    const chunks: EncodedVideoChunk[] = [];

    const demuxResult = await demuxVideo(file, (chunk) => {
        chunks.push(chunk);
    });

    // Now create decoder with the config and decode all chunks
    return new Promise((resolve, reject) => {
        const decoder = createVideoDecoder({
            config: demuxResult.config,
            onFrame: (frame, index) => {
                const callbackResult = onFrame(frame, index);
                if (callbackResult instanceof Promise) {
                    callbackResult.catch(reject);
                }
            },
            onError: reject,
        });

        // Decode all buffered chunks
        for (const chunk of chunks) {
            decoder.decode(chunk);
        }

        // Flush and resolve
        decoder.flush().then(() => {
            const totalFrames = decoder.decodedCount;
            decoder.close();
            resolve({
                trackInfo: demuxResult.trackInfo,
                totalFrames,
            });
        }).catch(reject);
    });
}

/**
 * Extract all frames from a video and save them to OPFS
 * Uses a queue with concurrency limiting to avoid memory exhaustion
 * @param file - The OPFS file metadata
 * @param options - Format, quality, and progress callback options
 * @returns Promise with track info and stored frame info
 */
export async function extractAndStoreFrames(
    file: OPFSFileMetadata,
    options: ExtractFramesOptions = {}
): Promise<ExtractFramesResult> {
    const { format = 'webp', quality = 0.9, onProgress, maxConcurrency = 4 } = options;
    const frames: StoredFrameInfo[] = [];

    // First, demux to get chunk count and config
    const chunks: EncodedVideoChunk[] = [];
    const demuxResult = await demuxVideo(file, (chunk) => {
        chunks.push(chunk);
    });

    const totalFrames = demuxResult.trackInfo.frameCount;

    // Queue for frames waiting to be processed
    const frameQueue: { frame: VideoFrame; index: number }[] = [];
    let activeCount = 0;
    let completedCount = 0;
    let hasError = false;
    let processingComplete = false;

    // Resolve/reject handlers for the main promise
    let resolveMain: (result: ExtractFramesResult) => void;
    let rejectMain: (error: unknown) => void;

    const processNext = async () => {
        if (hasError || frameQueue.length === 0 || activeCount >= maxConcurrency) {
            return;
        }

        const { frame, index } = frameQueue.shift()!;
        activeCount++;

        try {
            const frameInfo = await saveFrameToOPFS(frame, file.opfsPath, index, {
                format,
                quality,
            });
            frames.push(frameInfo);
            completedCount++;

            if (onProgress) {
                onProgress(completedCount, totalFrames);
            }
        } catch (err) {
            if (!hasError) {
                hasError = true;
                rejectMain(err);
            }
        } finally {
            frame.close();
            activeCount--;

            // Process next frame in queue
            processNext();

            // Check if all done
            if (processingComplete && activeCount === 0 && frameQueue.length === 0 && !hasError) {
                frames.sort((a, b) => a.index - b.index);
                resolveMain({
                    trackInfo: demuxResult.trackInfo,
                    frames,
                    format,
                });
            }
        }
    };

    return new Promise((resolve, reject) => {
        resolveMain = resolve;
        rejectMain = reject;

        const decoder = createVideoDecoder({
            config: demuxResult.config,
            onFrame: (frame, index) => {
                frameQueue.push({ frame, index });
                processNext();
            },
            onError: (err) => {
                if (!hasError) {
                    hasError = true;
                    reject(err);
                }
            },
        });

        // Decode all chunks
        for (const chunk of chunks) {
            decoder.decode(chunk);
        }

        // Flush decoder
        decoder.flush().then(() => {
            decoder.close();
            processingComplete = true;

            // If queue is empty and nothing active, resolve immediately
            if (activeCount === 0 && frameQueue.length === 0 && !hasError) {
                frames.sort((a, b) => a.index - b.index);
                resolve({
                    trackInfo: demuxResult.trackInfo,
                    frames,
                    format,
                });
            }
        }).catch((err) => {
            if (!hasError) {
                hasError = true;
                reject(err);
            }
        });
    });
}
