/**
 * Asset Type Definitions
 *
 * Assets are immutable data sources stored in the AssetLibrary.
 * They represent the raw media (video, image, shape) or compositions.
 */

import type { SceneNode, Connection } from './scene-graph';

// =============================================================================
// Asset Types
// =============================================================================

export type AssetType = 'video' | 'image' | 'shape' | 'composition';

/**
 * Loading state for assets being processed
 */
export interface AssetLoadingState {
  /** Whether the asset is currently being processed */
  isLoading: boolean;
  /** Progress of processing (0-1) */
  progress?: number;
  /** Error message if processing failed */
  error?: string;
}

/**
 * Base asset interface - all assets extend this
 */
export interface BaseAsset {
  id: string;
  type: AssetType;
  name: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  createdAt: number;
  updatedAt: number;
  /** Loading state for async processing */
  loadingState?: AssetLoadingState;
}

// =============================================================================
// Video Asset
// =============================================================================

export interface VideoAssetMetadata {
  /** OPFS path to the video file (or base path for sequences) */
  fileHandleId: string;
  /** Duration in seconds */
  duration: number;
  /** Frames per second */
  fps: number;
  /** MP4Box video track ID for extraction (0 for image sequences) */
  videoTrackId: number;
  /** Codec MIME type (e.g., "avc1.42E01E") or image MIME type for sequences */
  mimeType: string;
  /** Total number of frames */
  frameCount: number;
  /** Format of extracted frames */
  extractedFrameFormat?: 'webp' | 'png' | 'jpeg';
  /** Whether frames have been extracted */
  framesExtracted?: boolean;
  /** Whether this is an image sequence (not a decoded video) */
  isImageSequence?: boolean;
  /** For image sequences: map of frame index to OPFS path */
  sequenceFramePaths?: Record<number, string>;
}

export interface VideoAsset extends BaseAsset {
  type: 'video';
  metadata: VideoAssetMetadata;
}

// =============================================================================
// Image Asset
// =============================================================================

export interface ImageAssetMetadata {
  /** OPFS path to the image file */
  fileHandleId: string;
  /** Original MIME type */
  mimeType?: string;
}

export interface ImageAsset extends BaseAsset {
  type: 'image';
  metadata: ImageAssetMetadata;
}

// =============================================================================
// Shape Asset
// =============================================================================

export interface ShapeAssetMetadata {
  /** SVG path d="" attribute (may contain multiple paths separated by newlines) */
  pathData: string;
  /** Fill rule for the path */
  fillRule?: 'evenodd' | 'nonzero';
  /** Fill color (CSS color string or 'none') */
  fillColor?: string;
  /** Fill opacity (0-1) */
  fillOpacity?: number;
  /** Stroke color (CSS color string or 'none') */
  strokeColor?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Stroke opacity (0-1) */
  strokeOpacity?: number;
  /** Stroke line cap */
  strokeLinecap?: 'butt' | 'round' | 'square';
  /** Stroke line join */
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  /** Stroke miter limit */
  strokeMiterlimit?: number;
  /** Stroke dash array */
  strokeDasharray?: number[];
  /** Stroke dash offset */
  strokeDashoffset?: number;
  /** Original SVG source (for reference) */
  originalSVG?: string;
  /** Multiple paths with individual styles (for complex SVGs) */
  paths?: Array<{
    pathData: string;
    fillColor?: string;
    fillOpacity?: number;
    fillRule?: 'evenodd' | 'nonzero';
    strokeColor?: string;
    strokeWidth?: number;
    strokeOpacity?: number;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeLinejoin?: 'miter' | 'round' | 'bevel';
    strokeMiterlimit?: number;
    strokeDasharray?: number[];
    strokeDashoffset?: number;
  }>;
}

export interface ShapeAsset extends BaseAsset {
  type: 'shape';
  metadata: ShapeAssetMetadata;
}

// =============================================================================
// Composition Asset
// =============================================================================

export interface CompositionDimensions {
  width: number;
  height: number;
}

export interface CompositionGraph {
  nodes: Record<string, SceneNode>;
  edges: Connection[];
}

export interface CompositionAsset extends BaseAsset {
  type: 'composition';
  /** Output dimensions of the composition */
  dimensions: CompositionDimensions;
  /** Frame rate of the composition */
  fps: number;
  /** Duration in frames (total length of composition) */
  durationFrames: number;
  /** Work area start frame (in point for playback) */
  workAreaStart: number;
  /** Work area end frame (out point for playback) */
  workAreaEnd: number;
  /** The scene graph for this composition */
  graph: CompositionGraph;
}

// =============================================================================
// Union Type
// =============================================================================

export type Asset = VideoAsset | ImageAsset | ShapeAsset | CompositionAsset;

// =============================================================================
// Type Guards
// =============================================================================

export function isVideoAsset(asset: Asset): asset is VideoAsset {
  return asset.type === 'video';
}

export function isImageAsset(asset: Asset): asset is ImageAsset {
  return asset.type === 'image';
}

export function isShapeAsset(asset: Asset): asset is ShapeAsset {
  return asset.type === 'shape';
}

export function isCompositionAsset(asset: Asset): asset is CompositionAsset {
  return asset.type === 'composition';
}

/**
 * Check if an asset is a media asset (has frames to render)
 */
export function isMediaAsset(asset: Asset): asset is VideoAsset | ImageAsset {
  return asset.type === 'video' || asset.type === 'image';
}

/**
 * Check if an asset is still loading/processing
 */
export function isAssetLoading(asset: Asset): boolean {
  return asset.loadingState?.isLoading ?? false;
}

/**
 * Check if an asset has finished loading and is ready to use
 */
export function isAssetReady(asset: Asset): boolean {
  return !asset.loadingState?.isLoading && !asset.loadingState?.error;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the dimensions of an asset
 */
export function getAssetDimensions(asset: Asset): { width: number; height: number } {
  if (isCompositionAsset(asset)) {
    return asset.dimensions;
  }
  return {
    width: asset.intrinsicWidth,
    height: asset.intrinsicHeight,
  };
}

/**
 * Get the frame count for an asset
 * - Video: actual frame count from metadata
 * - Image: 1 (single frame)
 * - Shape: 1 (single frame)
 * - Composition: durationFrames
 */
export function getAssetFrameCount(asset: Asset): number {
  switch (asset.type) {
    case 'video':
      return asset.metadata.frameCount;
    case 'image':
    case 'shape':
      return 1;
    case 'composition':
      return asset.durationFrames;
  }
}

/**
 * Get the FPS for an asset
 * - Video: actual fps from metadata
 * - Image/Shape: N/A (returns undefined)
 * - Composition: composition fps
 */
export function getAssetFps(asset: Asset): number | undefined {
  switch (asset.type) {
    case 'video':
      return asset.metadata.fps;
    case 'composition':
      return asset.fps;
    default:
      return undefined;
  }
}
