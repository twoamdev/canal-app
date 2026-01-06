export type FrameCallback = (frame: VideoFrame, index: number) => void;

export interface DecoderOptions {
    config: VideoDecoderConfig;
    onFrame: FrameCallback;
    onError?: (error: Error) => void;
}

export interface VideoDecoderInstance {
    decode: (chunk: EncodedVideoChunk) => void;
    flush: () => Promise<void>;
    close: () => void;
    readonly decodedCount: number;
}

/**
 * Create a video decoder instance
 * @param options - Decoder configuration and callbacks
 * @returns Decoder instance with decode/flush/close methods
 */
export function createVideoDecoder(options: DecoderOptions): VideoDecoderInstance {
    const { config, onFrame, onError } = options;
    let frameIndex = 0;
    let decodedCount = 0;

    const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
            onFrame(frame, frameIndex);
            frameIndex++;
            decodedCount++;
        },
        error: (error: DOMException) => {
            if (onError) {
                onError(new Error(`VideoDecoder error: ${error.message}`));
            } else {
                console.error('VideoDecoder error:', error);
            }
        },
    });

    decoder.configure(config);

    return {
        decode: (chunk: EncodedVideoChunk) => {
            decoder.decode(chunk);
        },
        flush: async () => {
            await decoder.flush();
        },
        close: () => {
            decoder.close();
        },
        get decodedCount() {
            return decodedCount;
        },
    };
}

/**
 * Decode all chunks from a demuxed video
 * Convenience function that handles the full decode pipeline
 * @param config - VideoDecoderConfig from demuxVideo()
 * @param chunks - Array of EncodedVideoChunks or an async iterable
 * @param onFrame - Callback for each decoded frame
 * @returns Promise that resolves when all frames are decoded
 */
export async function decodeAllChunks(
    config: VideoDecoderConfig,
    chunks: EncodedVideoChunk[],
    onFrame: FrameCallback
): Promise<{ totalFrames: number }> {
    return new Promise((resolve, reject) => {
        const decoder = createVideoDecoder({
            config,
            onFrame,
            onError: reject,
        });

        for (const chunk of chunks) {
            decoder.decode(chunk);
        }

        decoder.flush().then(() => {
            const totalFrames = decoder.decodedCount;
            decoder.close();
            resolve({ totalFrames });
        }).catch(reject);
    });
}
