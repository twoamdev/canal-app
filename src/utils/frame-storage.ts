import { opfsManager } from './opfs';

export type FrameFormat = 'png' | 'webp' | 'jpeg';

export interface FrameStorageOptions {
    format?: FrameFormat;
    quality?: number; // 0-1, only applies to webp/jpeg
}

export interface StoredFrameInfo {
    index: number;
    path: string;
    timestamp: number;
    width: number;
    height: number;
}

/**
 * Get the folder path for storing frames of a video
 */
export function getFramesFolderPath(videoPath: string): string {
    // Create a frames folder based on the video path
    const videoName = videoPath.replace(/\//g, '_').replace(/\.[^.]+$/, '');
    return `frames/${videoName}`;
}

/**
 * Get the file path for a specific frame
 */
export function getFramePath(videoPath: string, frameIndex: number, format: FrameFormat): string {
    const folder = getFramesFolderPath(videoPath);
    return `${folder}/frame_${frameIndex.toString().padStart(6, '0')}.${format}`;
}

/**
 * Convert a VideoFrame to a Blob in the specified format
 */
export async function videoFrameToBlob(
    frame: VideoFrame,
    format: FrameFormat = 'webp',
    quality: number = 0.9
): Promise<Blob> {
    // Validate frame before processing
    if (!frame || frame.displayWidth === 0 || frame.displayHeight === 0) {
        throw new Error(`Invalid VideoFrame: dimensions ${frame?.displayWidth}x${frame?.displayHeight}`);
    }

    // Create an OffscreenCanvas to draw the frame
    const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Failed to get canvas context');
    }

    // Draw the VideoFrame to the canvas
    ctx.drawImage(frame, 0, 0);

    // Convert to blob
    const mimeType = format === 'png' ? 'image/png' :
                     format === 'webp' ? 'image/webp' : 'image/jpeg';

    // PNG doesn't use quality parameter
    const blob = format === 'png'
        ? await canvas.convertToBlob({ type: mimeType })
        : await canvas.convertToBlob({ type: mimeType, quality });

    return blob;
}

/**
 * Save a VideoFrame to OPFS
 */
export async function saveFrameToOPFS(
    frame: VideoFrame,
    videoPath: string,
    frameIndex: number,
    options: FrameStorageOptions = {}
): Promise<StoredFrameInfo> {
    const { format = 'webp', quality = 0.9 } = options;

    const blob = await videoFrameToBlob(frame, format, quality);
    const framePath = getFramePath(videoPath, frameIndex, format);

    // Convert blob to File for OPFS storage
    const file = new File([blob], `frame_${frameIndex}.${format}`, { type: blob.type });
    await opfsManager.storeFile(file, framePath);

    return {
        index: frameIndex,
        path: framePath,
        timestamp: frame.timestamp ?? 0,
        width: frame.displayWidth,
        height: frame.displayHeight,
    };
}

/**
 * Load a frame from OPFS as an ImageBitmap (for drawing to canvas)
 */
export async function loadFrameFromOPFS(framePath: string): Promise<ImageBitmap> {
    const file = await opfsManager.getFile(framePath);
    return createImageBitmap(file);
}

/**
 * Load a frame from OPFS as a Blob URL (for <img> src)
 */
export async function loadFrameAsURL(framePath: string): Promise<string> {
    const file = await opfsManager.getFile(framePath);
    return URL.createObjectURL(file);
}

/**
 * Get frame by index for a video
 */
export async function getFrame(
    videoPath: string,
    frameIndex: number,
    format: FrameFormat = 'webp'
): Promise<ImageBitmap> {
    const framePath = getFramePath(videoPath, frameIndex, format);
    return loadFrameFromOPFS(framePath);
}

/**
 * Get frame URL by index for a video (for use in <img> tags)
 */
export async function getFrameURL(
    videoPath: string,
    frameIndex: number,
    format: FrameFormat = 'webp'
): Promise<string> {
    const framePath = getFramePath(videoPath, frameIndex, format);
    return loadFrameAsURL(framePath);
}

/**
 * Delete all stored frames for a video
 */
export async function deleteVideoFrames(videoPath: string, frameCount: number, format: FrameFormat = 'webp'): Promise<void> {
    const deletePromises: Promise<void>[] = [];

    for (let i = 0; i < frameCount; i++) {
        const framePath = getFramePath(videoPath, i, format);
        deletePromises.push(
            opfsManager.deleteFile(framePath).catch(() => {
                // Ignore errors for missing frames
            })
        );
    }

    await Promise.all(deletePromises);
}
