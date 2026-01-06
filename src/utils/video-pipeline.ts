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
 * @param file - The OPFS file metadata
 * @param options - Format, quality, and progress callback options
 * @returns Promise with track info and stored frame info
 */
export async function extractAndStoreFrames(
    file: OPFSFileMetadata,
    options: ExtractFramesOptions = {}
): Promise<ExtractFramesResult> {
    const { format = 'webp', quality = 0.9, onProgress } = options;
    const frames: StoredFrameInfo[] = [];
    const savePromises: Promise<void>[] = [];

    // First, demux to get chunk count and config
    const chunks: EncodedVideoChunk[] = [];
    const demuxResult = await demuxVideo(file, (chunk) => {
        chunks.push(chunk);
    });

    const totalFrames = demuxResult.trackInfo.frameCount;

    // Now decode and save each frame
    return new Promise((resolve, reject) => {
        const decoder = createVideoDecoder({
            config: demuxResult.config,
            onFrame: (frame, index) => {
                // Start async save and track the promise
                const savePromise = (async () => {
                    try {
                        const frameInfo = await saveFrameToOPFS(frame, file.opfsPath, index, {
                            format,
                            quality,
                        });
                        frames.push(frameInfo);

                        // Close the frame to free memory
                        frame.close();

                        // Report progress
                        if (onProgress) {
                            onProgress(frames.length, totalFrames);
                        }
                    } catch (err) {
                        reject(err);
                    }
                })();
                savePromises.push(savePromise);
            },
            onError: reject,
        });

        // Decode all chunks
        for (const chunk of chunks) {
            decoder.decode(chunk);
        }

        // Flush decoder, then wait for all saves to complete
        decoder.flush().then(async () => {
            decoder.close();
            // Wait for all frame saves to complete
            await Promise.all(savePromises);
            // Sort frames by index since they may complete out of order
            frames.sort((a, b) => a.index - b.index);
            resolve({
                trackInfo: demuxResult.trackInfo,
                frames,
                format,
            });
        }).catch(reject);
    });
}
