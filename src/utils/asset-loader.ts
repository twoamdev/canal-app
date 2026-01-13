/**
 * Asset Loader
 *
 * Utilities for loading asset data (frames, images) for rendering.
 * Handles OPFS retrieval and caching.
 */

import type {
  Asset,
  VideoAsset,
  ImageAsset,
  ShapeAsset,
} from '../types/assets';
import {
  isVideoAsset,
  isImageAsset,
  isShapeAsset,
  isCompositionAsset,
  getAssetFrameCount,
} from '../types/assets';
import { opfsManager } from './opfs';
import { getFramePath } from './frame-storage';

// =============================================================================
// Frame Loading
// =============================================================================

/**
 * Load a frame from a VideoAsset
 */
export async function loadVideoFrame(
  asset: VideoAsset,
  frameIndex: number
): Promise<ImageBitmap> {
  const { fileHandleId, extractedFrameFormat, framesExtracted, frameCount } =
    asset.metadata;

  if (!framesExtracted || !extractedFrameFormat) {
    throw new Error('Video frames have not been extracted yet');
  }

  // Clamp frame index to valid range
  const clampedIndex = Math.max(0, Math.min(frameIndex, frameCount - 1));

  const framePath = getFramePath(fileHandleId, clampedIndex, extractedFrameFormat);
  const file = await opfsManager.getFile(framePath);
  return createImageBitmap(file);
}

/**
 * Load an ImageAsset as an ImageBitmap
 */
export async function loadImageAsset(asset: ImageAsset): Promise<ImageBitmap> {
  const file = await opfsManager.getFile(asset.metadata.fileHandleId);
  return createImageBitmap(file);
}

/**
 * Load a frame from any media asset (video or image)
 * For images, frameIndex is ignored
 */
export async function loadAssetFrame(
  asset: VideoAsset | ImageAsset,
  frameIndex: number = 0
): Promise<ImageBitmap> {
  if (isVideoAsset(asset)) {
    return loadVideoFrame(asset, frameIndex);
  }

  if (isImageAsset(asset)) {
    return loadImageAsset(asset);
  }

  throw new Error(`Cannot load frame from asset type: ${(asset as Asset).type}`);
}

// =============================================================================
// Shape Rendering
// =============================================================================

/**
 * Render a ShapeAsset to an ImageBitmap
 */
export async function renderShapeAsset(asset: ShapeAsset): Promise<ImageBitmap> {
  const { pathData, fillRule, fillColor, strokeColor, strokeWidth } =
    asset.metadata;

  // Create an OffscreenCanvas
  const canvas = new OffscreenCanvas(asset.intrinsicWidth, asset.intrinsicHeight);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Create path
  const path = new Path2D(pathData);

  // Apply fill
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill(path, fillRule);
  }

  // Apply stroke
  if (strokeColor && strokeWidth) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke(path);
  }

  // Convert to ImageBitmap
  return createImageBitmap(canvas);
}

// =============================================================================
// Generic Asset Loading
// =============================================================================

/**
 * Load any asset as an ImageBitmap for the given frame
 * - Video: loads the specified frame
 * - Image: loads the image (frameIndex ignored)
 * - Shape: renders the shape (frameIndex ignored)
 * - Composition: throws (needs special handling)
 */
export async function loadAssetAsBitmap(
  asset: Asset,
  frameIndex: number = 0
): Promise<ImageBitmap> {
  if (isVideoAsset(asset)) {
    return loadVideoFrame(asset, frameIndex);
  }

  if (isImageAsset(asset)) {
    return loadImageAsset(asset);
  }

  if (isShapeAsset(asset)) {
    return renderShapeAsset(asset);
  }

  if (isCompositionAsset(asset)) {
    throw new Error(
      'CompositionAsset requires special rendering - use CompositionRenderer'
    );
  }

  throw new Error(`Unknown asset type: ${(asset as Asset).type}`);
}

// =============================================================================
// Frame Index Utilities
// =============================================================================

/**
 * Clamp a frame index to the valid range for an asset
 */
export function clampFrameIndex(asset: Asset, frameIndex: number): number {
  const frameCount = getAssetFrameCount(asset);
  return Math.max(0, Math.min(frameIndex, frameCount - 1));
}

/**
 * Check if an asset has a valid frame at the given index
 */
export function hasFrameAtIndex(asset: Asset, frameIndex: number): boolean {
  const frameCount = getAssetFrameCount(asset);
  return frameIndex >= 0 && frameIndex < frameCount;
}

/**
 * Map a global timeline frame to a source frame for an asset
 * Takes into account the layer's time range
 */
export function mapGlobalFrameToSource(
  globalFrame: number,
  timeRange: { inFrame: number; outFrame: number; sourceOffset: number },
  asset: Asset
): number | null {
  const { inFrame, outFrame, sourceOffset } = timeRange;

  // Check if the global frame is within this layer's active range
  if (globalFrame < inFrame || globalFrame >= outFrame) {
    return null; // Layer is not active at this frame
  }

  // Calculate the source frame
  const relativeFrame = globalFrame - inFrame;
  const sourceFrame = sourceOffset + relativeFrame;

  // Clamp to valid range for the asset
  const frameCount = getAssetFrameCount(asset);
  return Math.max(0, Math.min(sourceFrame, frameCount - 1));
}

// =============================================================================
// Preloading
// =============================================================================

/**
 * Preload frames for a video asset
 * Returns a Map of frame index to ImageBitmap
 */
export async function preloadVideoFrames(
  asset: VideoAsset,
  startFrame: number,
  endFrame: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<Map<number, ImageBitmap>> {
  const frames = new Map<number, ImageBitmap>();
  const total = endFrame - startFrame;
  let loaded = 0;

  const loadPromises: Promise<void>[] = [];

  for (let i = startFrame; i < endFrame; i++) {
    const frameIndex = i;
    loadPromises.push(
      loadVideoFrame(asset, frameIndex)
        .then((bitmap) => {
          frames.set(frameIndex, bitmap);
          loaded++;
          onProgress?.(loaded, total);
        })
        .catch((error) => {
          console.warn(`Failed to preload frame ${frameIndex}:`, error);
        })
    );
  }

  await Promise.all(loadPromises);
  return frames;
}

// =============================================================================
// Frame Cache
// =============================================================================

/**
 * Simple LRU cache for loaded frames
 */
export class FrameCache {
  private cache = new Map<string, ImageBitmap>();
  private accessOrder: string[] = [];
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Generate a cache key for an asset frame
   */
  private getCacheKey(assetId: string, frameIndex: number): string {
    return `${assetId}:${frameIndex}`;
  }

  /**
   * Get a frame from the cache
   */
  get(assetId: string, frameIndex: number): ImageBitmap | undefined {
    const key = this.getCacheKey(assetId, frameIndex);
    const bitmap = this.cache.get(key);

    if (bitmap) {
      // Move to end of access order (most recently used)
      const index = this.accessOrder.indexOf(key);
      if (index !== -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(key);
    }

    return bitmap;
  }

  /**
   * Set a frame in the cache
   */
  set(assetId: string, frameIndex: number, bitmap: ImageBitmap): void {
    const key = this.getCacheKey(assetId, frameIndex);

    // If already in cache, update access order
    if (this.cache.has(key)) {
      const index = this.accessOrder.indexOf(key);
      if (index !== -1) {
        this.accessOrder.splice(index, 1);
      }
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift()!;
      const oldBitmap = this.cache.get(oldestKey);
      if (oldBitmap) {
        oldBitmap.close();
      }
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, bitmap);
    this.accessOrder.push(key);
  }

  /**
   * Check if a frame is in the cache
   */
  has(assetId: string, frameIndex: number): boolean {
    return this.cache.has(this.getCacheKey(assetId, frameIndex));
  }

  /**
   * Clear all entries for a specific asset
   */
  clearAsset(assetId: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${assetId}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const bitmap = this.cache.get(key);
      if (bitmap) {
        bitmap.close();
      }
      this.cache.delete(key);

      const index = this.accessOrder.indexOf(key);
      if (index !== -1) {
        this.accessOrder.splice(index, 1);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    for (const bitmap of this.cache.values()) {
      bitmap.close();
    }
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

// Global frame cache instance
export const globalFrameCache = new FrameCache(100);
