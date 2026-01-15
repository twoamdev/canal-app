/**
 * Asset Factory
 *
 * Factory functions for creating assets from various sources.
 * Handles file storage to OPFS and metadata extraction.
 */

import type {
  Asset,
  VideoAsset,
  ImageAsset,
  ShapeAsset,
  CompositionAsset,
  VideoAssetMetadata,
} from '../types/assets';
import { opfsManager } from './opfs';
import { extractAndStoreFrames, type ExtractFramesOptions } from './video-pipeline';
import type { FrameFormat } from './frame-storage';

// =============================================================================
// ID Generation
// =============================================================================

let assetIdCounter = 0;

/**
 * Generate a unique asset ID
 */
export function generateAssetId(prefix: string = 'asset'): string {
  return `${prefix}_${Date.now()}_${++assetIdCounter}`;
}

// =============================================================================
// Placeholder Assets
// =============================================================================

/**
 * Create a placeholder VideoAsset for a file that's being processed
 * The asset will be marked as loading and have placeholder dimensions
 */
export function createPlaceholderVideoAsset(
  file: File,
  id?: string
): VideoAsset {
  const now = Date.now();
  const assetId = id ?? generateAssetId('video');

  return {
    id: assetId,
    type: 'video',
    name: file.name,
    intrinsicWidth: 1920, // Placeholder dimensions
    intrinsicHeight: 1080,
    createdAt: now,
    updatedAt: now,
    loadingState: {
      isLoading: true,
      progress: 0,
    },
    metadata: {
      fileHandleId: '', // Will be set when processing completes
      duration: 0,
      fps: 30, // Placeholder fps
      videoTrackId: 1,
      mimeType: file.type,
      frameCount: 0,
      framesExtracted: false,
    },
  };
}

/**
 * Create a placeholder ImageAsset for a file that's being processed
 */
export function createPlaceholderImageAsset(
  file: File,
  id?: string
): ImageAsset {
  const now = Date.now();
  const assetId = id ?? generateAssetId('image');

  return {
    id: assetId,
    type: 'image',
    name: file.name,
    intrinsicWidth: 800, // Placeholder dimensions
    intrinsicHeight: 600,
    createdAt: now,
    updatedAt: now,
    loadingState: {
      isLoading: true,
      progress: 0,
    },
    metadata: {
      fileHandleId: '', // Will be set when processing completes
      mimeType: file.type,
    },
  };
}

/**
 * Create a placeholder asset based on file type
 */
export function createPlaceholderAsset(file: File): VideoAsset | ImageAsset {
  if (isVideoFile(file)) {
    return createPlaceholderVideoAsset(file);
  }
  return createPlaceholderImageAsset(file);
}

// =============================================================================
// Video Asset Creation
// =============================================================================

export interface CreateVideoAssetOptions {
  /** Format for extracted frames */
  frameFormat?: FrameFormat;
  /** Quality for frame compression (0-1) */
  frameQuality?: number;
  /** Progress callback for frame extraction */
  onProgress?: (current: number, total: number) => void;
  /** Whether to extract frames immediately */
  extractFrames?: boolean;
}

/**
 * Create a VideoAsset from a File
 * Stores the file to OPFS and optionally extracts frames
 */
export async function createVideoAsset(
  file: File,
  options: CreateVideoAssetOptions = {}
): Promise<VideoAsset> {
  const {
    frameFormat = 'webp',
    frameQuality = 0.9,
    onProgress,
    extractFrames = true,
  } = options;

  // Store file to OPFS
  const opfsPath = await opfsManager.storeFile(
    file,
    `videos/${Date.now()}-${file.name}`
  );

  // Get file metadata from OPFS
  const fileMetadata = await opfsManager.getFileMetadata(opfsPath);

  // Extract frames and get video metadata
  let videoMetadata: VideoAssetMetadata;
  let intrinsicWidth = 0;
  let intrinsicHeight = 0;

  if (extractFrames) {
    const extractResult = await extractAndStoreFrames(fileMetadata, {
      format: frameFormat,
      quality: frameQuality,
      onProgress,
    } as ExtractFramesOptions);

    const { trackInfo } = extractResult;

    intrinsicWidth = trackInfo.width;
    intrinsicHeight = trackInfo.height;

    videoMetadata = {
      fileHandleId: opfsPath,
      duration: trackInfo.duration,
      fps: trackInfo.frameRate,
      videoTrackId: 1, // Default video track
      mimeType: file.type,
      frameCount: trackInfo.frameCount,
      extractedFrameFormat: frameFormat,
      framesExtracted: true,
    };
  } else {
    // If not extracting frames, we still need basic metadata
    // This is a placeholder - in production you'd want to probe the video
    videoMetadata = {
      fileHandleId: opfsPath,
      duration: 0,
      fps: 30,
      videoTrackId: 1,
      mimeType: file.type,
      frameCount: 0,
      framesExtracted: false,
    };
  }

  const now = Date.now();

  return {
    id: generateAssetId('video'),
    type: 'video',
    name: file.name,
    intrinsicWidth,
    intrinsicHeight,
    createdAt: now,
    updatedAt: now,
    metadata: videoMetadata,
  };
}

/**
 * Create a VideoAsset with known metadata (e.g., after frame extraction)
 */
export function createVideoAssetWithMetadata(
  name: string,
  metadata: VideoAssetMetadata,
  dimensions: { width: number; height: number }
): VideoAsset {
  const now = Date.now();

  return {
    id: generateAssetId('video'),
    type: 'video',
    name,
    intrinsicWidth: dimensions.width,
    intrinsicHeight: dimensions.height,
    createdAt: now,
    updatedAt: now,
    metadata,
  };
}

// =============================================================================
// Image Sequence Asset Creation
// =============================================================================

import type { DetectedSequence } from './image-sequence';
import { getSequenceDisplayName } from './image-sequence';

export interface CreateImageSequenceAssetOptions {
  /** Custom name for the asset */
  name?: string;
  /** Assumed FPS for the sequence (default: 24) */
  fps?: number;
  /** Progress callback */
  onProgress?: (current: number, total: number) => void;
}

/**
 * Create a placeholder VideoAsset for an image sequence that's being processed
 */
export function createPlaceholderSequenceAsset(
  sequence: DetectedSequence,
  id?: string
): VideoAsset {
  const now = Date.now();
  const assetId = id ?? generateAssetId('seq');
  const name = getSequenceDisplayName(sequence);

  return {
    id: assetId,
    type: 'video',
    name,
    intrinsicWidth: 1920, // Placeholder - will be updated from first frame
    intrinsicHeight: 1080,
    createdAt: now,
    updatedAt: now,
    loadingState: {
      isLoading: true,
      progress: 0,
    },
    metadata: {
      fileHandleId: '', // Will be set when processing completes
      duration: sequence.frameCount / 24, // Estimated at 24fps
      fps: 24,
      videoTrackId: 0,
      mimeType: `image/${sequence.extension}`,
      frameCount: sequence.frameCount,
      framesExtracted: false,
      isImageSequence: true,
    },
  };
}

/**
 * Create a VideoAsset from an image sequence
 * Stores all frames to OPFS and creates the asset
 */
export async function createImageSequenceAsset(
  sequence: DetectedSequence,
  options: CreateImageSequenceAssetOptions = {}
): Promise<VideoAsset> {
  const { name, fps = 24, onProgress } = options;
  const displayName = name ?? getSequenceDisplayName(sequence);

  // Store all frames to OPFS and track their paths
  const sequenceFramePaths: Record<number, string> = {};
  const basePath = `sequences/${Date.now()}-${sequence.baseName.replace(/[^a-zA-Z0-9]/g, '_')}`;

  let width = 0;
  let height = 0;

  for (let i = 0; i < sequence.files.length; i++) {
    const seqFile = sequence.files[i];
    const frameIndex = i; // Use sequential index for consistent frame numbering

    // Store the frame
    const framePath = `${basePath}/frame_${frameIndex.toString().padStart(6, '0')}.${sequence.extension}`;
    await opfsManager.storeFile(seqFile.file, framePath);

    sequenceFramePaths[frameIndex] = framePath;

    // Get dimensions from first frame
    if (i === 0) {
      const dimensions = await getImageDimensionsFromFile(seqFile.file);
      width = dimensions.width;
      height = dimensions.height;
    }

    onProgress?.(i + 1, sequence.files.length);
  }

  const frameCount = sequence.files.length;
  const duration = frameCount / fps;

  const now = Date.now();

  return {
    id: generateAssetId('seq'),
    type: 'video',
    name: displayName,
    intrinsicWidth: width,
    intrinsicHeight: height,
    createdAt: now,
    updatedAt: now,
    metadata: {
      fileHandleId: basePath,
      duration,
      fps,
      videoTrackId: 0, // Not applicable for sequences
      mimeType: `image/${sequence.extension}`,
      frameCount,
      extractedFrameFormat: sequence.extension as 'png' | 'jpeg' | 'webp',
      framesExtracted: true,
      isImageSequence: true,
      sequenceFramePaths,
    },
  };
}

/**
 * Get image dimensions from a File object
 */
async function getImageDimensionsFromFile(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

// =============================================================================
// Image Asset Creation
// =============================================================================

export interface CreateImageAssetOptions {
  /** Custom name for the asset */
  name?: string;
}

/**
 * Create an ImageAsset from a File
 * Stores the file to OPFS and extracts dimensions
 */
export async function createImageAsset(
  file: File,
  options: CreateImageAssetOptions = {}
): Promise<ImageAsset> {
  const { name = file.name } = options;

  // Store file to OPFS
  const opfsPath = await opfsManager.storeFile(
    file,
    `images/${Date.now()}-${file.name}`
  );

  // Get image dimensions
  const dimensions = await getImageDimensions(file);

  const now = Date.now();

  return {
    id: generateAssetId('image'),
    type: 'image',
    name,
    intrinsicWidth: dimensions.width,
    intrinsicHeight: dimensions.height,
    createdAt: now,
    updatedAt: now,
    metadata: {
      fileHandleId: opfsPath,
      mimeType: file.type,
    },
  };
}

/**
 * Get dimensions of an image file
 */
async function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

// =============================================================================
// Shape Asset Creation
// =============================================================================

export interface CreateShapeAssetOptions {
  /** Fill color (CSS color string) */
  fillColor?: string;
  /** Stroke color (CSS color string) */
  strokeColor?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Fill rule */
  fillRule?: 'evenodd' | 'nonzero';
}

/**
 * Create a ShapeAsset from SVG path data
 */
export function createShapeAsset(
  name: string,
  pathData: string,
  dimensions: { width: number; height: number },
  options: CreateShapeAssetOptions = {}
): ShapeAsset {
  const {
    fillColor = '#ffffff',
    strokeColor,
    strokeWidth,
    fillRule = 'nonzero',
  } = options;

  const now = Date.now();

  return {
    id: generateAssetId('shape'),
    type: 'shape',
    name,
    intrinsicWidth: dimensions.width,
    intrinsicHeight: dimensions.height,
    createdAt: now,
    updatedAt: now,
    metadata: {
      pathData,
      fillRule,
      fillColor,
      strokeColor,
      strokeWidth,
    },
  };
}

// =============================================================================
// Composition Asset Creation
// =============================================================================

export interface CreateCompositionAssetOptions {
  /** Duration in frames */
  durationFrames?: number;
  /** Work area start frame */
  workAreaStart?: number;
  /** Work area end frame */
  workAreaEnd?: number;
}

/**
 * Create an empty CompositionAsset
 */
export function createCompositionAsset(
  name: string,
  dimensions: { width: number; height: number },
  fps: number,
  options: CreateCompositionAssetOptions = {}
): CompositionAsset {
  const { durationFrames = fps * 10 } = options; // Default 10 seconds
  const { workAreaStart = 0, workAreaEnd = durationFrames } = options;

  const now = Date.now();

  return {
    id: generateAssetId('comp'),
    type: 'composition',
    name,
    intrinsicWidth: dimensions.width,
    intrinsicHeight: dimensions.height,
    dimensions,
    fps,
    durationFrames,
    workAreaStart,
    workAreaEnd,
    createdAt: now,
    updatedAt: now,
    graph: {
      nodes: {},
      edges: [],
    },
  };
}

// =============================================================================
// Auto-Detection
// =============================================================================

/**
 * Supported image MIME types
 */
const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
];

/**
 * Check if a file is a video
 */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

/**
 * Check if a file is an image
 */
export function isImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(file.type);
}

/**
 * Auto-detect file type and create appropriate asset
 * Returns VideoAsset or ImageAsset (never CompositionAsset or ShapeAsset)
 */
export async function createAssetFromFile(
  file: File,
  options?: CreateVideoAssetOptions & CreateImageAssetOptions
): Promise<VideoAsset | ImageAsset> {
  if (isVideoFile(file)) {
    return createVideoAsset(file, options);
  }

  if (isImageFile(file)) {
    return createImageAsset(file, options);
  }

  throw new Error(`Unsupported file type: ${file.type}`);
}

// =============================================================================
// Asset Duplication
// =============================================================================

/**
 * Duplicate an asset with a new ID
 * Note: For video/image assets, this creates a reference to the same OPFS file
 */
export function duplicateAsset(asset: Asset, newName?: string): Asset {
  const now = Date.now();
  const name = newName ?? `${asset.name} (copy)`;

  switch (asset.type) {
    case 'video':
      return {
        ...asset,
        id: generateAssetId('video'),
        name,
        createdAt: now,
        updatedAt: now,
      };

    case 'image':
      return {
        ...asset,
        id: generateAssetId('image'),
        name,
        createdAt: now,
        updatedAt: now,
      };

    case 'shape':
      return {
        ...asset,
        id: generateAssetId('shape'),
        name,
        createdAt: now,
        updatedAt: now,
        metadata: { ...asset.metadata },
      };

    case 'composition':
      return {
        ...asset,
        id: generateAssetId('comp'),
        name,
        createdAt: now,
        updatedAt: now,
        graph: {
          nodes: { ...asset.graph.nodes },
          edges: [...asset.graph.edges],
        },
      };
  }
}
