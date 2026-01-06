import * as MP4Box from 'mp4box';
import type { OPFSFileMetadata } from './opfs';
import { opfsManager } from './opfs';

// MP4Box types (the package doesn't export these properly)
interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
}

interface MP4Sample {
    is_sync: boolean;
    cts: number;
    duration: number;
    timescale: number;
    data: Uint8Array;
}

interface MP4VideoTrack {
    id: number;
    codec: string;
    duration: number;
    timescale: number;
    video: {
        width: number;
        height: number;
    };
}

interface MP4Info {
    videoTracks: MP4VideoTrack[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MP4File = any;

export interface DemuxerResult {
    config: VideoDecoderConfig;
    trackInfo: {
        width: number;
        height: number;
        duration: number;
        frameCount: number;
        frameRate: number;
    };
}

export type ChunkCallback = (chunk: EncodedVideoChunk, index: number) => void;

/**
 * Demux a video file from OPFS and extract video chunks
 * @param file - The OPFS file metadata
 * @param onChunk - Callback called for each video chunk
 * @returns Promise with decoder config and track info
 */
export async function demuxVideo(
    file: OPFSFileMetadata,
    onChunk: ChunkCallback
): Promise<DemuxerResult> {
    console.log('[demux] Starting demux for:', file.opfsPath);
    const videoFile = await opfsManager.getFile(file.opfsPath);
    console.log('[demux] Got file from OPFS:', videoFile.name, videoFile.size, 'bytes');
    const arrayBuffer = await videoFile.arrayBuffer();
    console.log('[demux] Got arrayBuffer, size:', arrayBuffer.byteLength);

    return new Promise((resolve, reject) => {
        const mp4boxFile: MP4File = MP4Box.createFile();
        let chunkIndex = 0;
        let videoTrack: MP4VideoTrack | null = null;
        let decoderConfig: VideoDecoderConfig | null = null;
        let frameCount = 0;

        mp4boxFile.onError = (error: string) => {
            console.error('[demux] MP4Box error:', error);
            reject(new Error(`MP4Box error: ${error}`));
        };

        let totalSamples = 0;

        mp4boxFile.onReady = (info: MP4Info) => {
            console.log('[demux] onReady fired, tracks:', info.videoTracks.length);
            // Find the video track
            const track = info.videoTracks[0];
            if (!track) {
                reject(new Error('No video track found in file'));
                return;
            }
            videoTrack = track;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            totalSamples = (track as any).nb_samples || 0;
            console.log('[demux] Total samples expected:', totalSamples);

            // Build the codec string
            const codec = track.codec;

            // Get the description (avcC/hvcC box) needed for decoder config
            const trak = mp4boxFile.getTrackById(track.id);
            const description = getCodecDescription(trak);

            decoderConfig = {
                codec,
                codedWidth: track.video.width,
                codedHeight: track.video.height,
                description,
            };

            // Set up extraction for this track
            mp4boxFile.setExtractionOptions(track.id, null, {
                nbSamples: Infinity,
            });

            console.log('[demux] Calling start() and flush()');
            mp4boxFile.start();
            mp4boxFile.flush();
        };

        mp4boxFile.onSamples = (_trackId: number, _user: unknown, samples: MP4Sample[]) => {
            console.log('[demux] onSamples fired, got', samples.length, 'samples');
            for (const sample of samples) {
                const chunk = new EncodedVideoChunk({
                    type: sample.is_sync ? 'key' : 'delta',
                    timestamp: (sample.cts * 1_000_000) / sample.timescale,
                    duration: (sample.duration * 1_000_000) / sample.timescale,
                    data: sample.data,
                });

                onChunk(chunk, chunkIndex);
                chunkIndex++;
                frameCount++;
            }

            // Check if we've received all samples
            if (frameCount >= totalSamples && videoTrack && decoderConfig) {
                console.log('[demux] All samples received, resolving...');
                const duration = videoTrack.duration / videoTrack.timescale;
                const frameRate = frameCount / duration;

                resolve({
                    config: decoderConfig,
                    trackInfo: {
                        width: videoTrack.video.width,
                        height: videoTrack.video.height,
                        duration,
                        frameCount,
                        frameRate,
                    },
                });
            }
        };

        // Append the buffer with fileStart position
        const mp4Buffer = arrayBuffer as MP4ArrayBuffer;
        mp4Buffer.fileStart = 0;
        console.log('[demux] Calling appendBuffer...');
        const nextPos = mp4boxFile.appendBuffer(mp4Buffer);
        console.log('[demux] appendBuffer returned:', nextPos);
    });
}

/**
 * Extract the codec description (avcC/hvcC box) from a track
 * This is required for VideoDecoder.configure()
 */
function getCodecDescription(trak: unknown): Uint8Array | undefined {
    // Navigate to the codec-specific box (avcC for H.264, hvcC for H.265)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trakBox = trak as any;
    const stsd = trakBox?.mdia?.minf?.stbl?.stsd;

    if (!stsd?.entries?.length) {
        return undefined;
    }

    const entry = stsd.entries[0];

    // Look for avcC (H.264) or hvcC (H.265) or av1C (AV1)
    const codecBox = entry.avcC || entry.hvcC || entry.av1C;

    if (!codecBox) {
        return undefined;
    }

    // Serialize the codec configuration box
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DataStream = MP4Box.DataStream as any;
    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    codecBox.write(stream);
    return new Uint8Array(stream.buffer, 8); // Skip the box header (8 bytes)
}
