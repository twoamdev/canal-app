/**
 * Texture Pool
 *
 * Manages GPU texture allocation with pooling and LRU eviction.
 * Prevents constant allocation/deallocation overhead during rendering.
 */

import type { GPUContext } from './GPUContext';
import type {
  GPUTexture,
  TextureFormat,
  TexturePoolOptions,
  TexturePoolStats,
} from './types';

interface PooledTexture {
  texture: GPUTexture;
  lastUsed: number;
  inUse: boolean;
}

interface TextureBucket {
  key: string;
  textures: PooledTexture[];
}

/**
 * Generate a key for texture dimensions and format
 */
function makeTextureKey(
  width: number,
  height: number,
  format: TextureFormat
): string {
  return `${width}x${height}_${format}`;
}

/**
 * Estimate memory usage for a texture in bytes
 */
function estimateTextureMemory(
  width: number,
  height: number,
  format: TextureFormat
): number {
  const pixels = width * height;
  switch (format) {
    case 'rgba8':
      return pixels * 4;
    case 'rgba16f':
      return pixels * 8;
    case 'rgba32f':
      return pixels * 16;
    default:
      return pixels * 4;
  }
}

export class TexturePool {
  private context: GPUContext;
  private buckets: Map<string, TextureBucket> = new Map();
  private options: Required<TexturePoolOptions>;

  // Statistics
  private totalMemory: number = 0;
  private activeCount: number = 0;
  private pooledCount: number = 0;

  // LRU tracking
  private lruOrder: PooledTexture[] = [];

  constructor(context: GPUContext, options: TexturePoolOptions = {}) {
    this.context = context;
    this.options = {
      maxTextures: options.maxTextures ?? 64,
      maxMemoryBytes: options.maxMemoryBytes ?? 512 * 1024 * 1024, // 512MB default
    };
  }

  /**
   * Acquire a texture from the pool or create a new one
   */
  acquire(
    width: number,
    height: number,
    format: TextureFormat = 'rgba8'
  ): GPUTexture {
    const key = makeTextureKey(width, height, format);
    let bucket = this.buckets.get(key);

    // Try to find an available texture in the bucket
    if (bucket) {
      for (const pooled of bucket.textures) {
        if (!pooled.inUse) {
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          this.activeCount++;
          this.pooledCount--;
          this.updateLRU(pooled);
          return pooled.texture;
        }
      }
    }

    // No available texture, check if we need to evict
    this.evictIfNeeded(width, height, format);

    // Create new texture
    const texture = this.context.createTexture({ width, height, format });
    const pooled: PooledTexture = {
      texture,
      lastUsed: Date.now(),
      inUse: true,
    };

    // Add to bucket
    if (!bucket) {
      bucket = { key, textures: [] };
      this.buckets.set(key, bucket);
    }
    bucket.textures.push(pooled);

    // Update stats
    this.activeCount++;
    this.totalMemory += estimateTextureMemory(width, height, format);
    this.lruOrder.push(pooled);

    return texture;
  }

  /**
   * Release a texture back to the pool
   */
  release(texture: GPUTexture): void {
    const key = makeTextureKey(texture.width, texture.height, texture.format);
    const bucket = this.buckets.get(key);

    if (!bucket) return;

    for (const pooled of bucket.textures) {
      if (pooled.texture === texture && pooled.inUse) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();
        this.activeCount--;
        this.pooledCount++;
        this.updateLRU(pooled);
        return;
      }
    }
  }

  /**
   * Dispose of a texture completely (remove from pool)
   */
  dispose(texture: GPUTexture): void {
    const key = makeTextureKey(texture.width, texture.height, texture.format);
    const bucket = this.buckets.get(key);

    if (!bucket) return;

    const index = bucket.textures.findIndex((p) => p.texture === texture);
    if (index !== -1) {
      const pooled = bucket.textures[index];
      bucket.textures.splice(index, 1);

      // Update stats
      if (pooled.inUse) {
        this.activeCount--;
      } else {
        this.pooledCount--;
      }
      this.totalMemory -= estimateTextureMemory(
        texture.width,
        texture.height,
        texture.format
      );

      // Remove from LRU
      const lruIndex = this.lruOrder.indexOf(pooled);
      if (lruIndex !== -1) {
        this.lruOrder.splice(lruIndex, 1);
      }

      // Actually dispose the GPU resource
      texture.dispose();
    }

    // Clean up empty buckets
    if (bucket.textures.length === 0) {
      this.buckets.delete(key);
    }
  }

  /**
   * Clear all pooled (unused) textures
   */
  clearPooled(): void {
    for (const bucket of this.buckets.values()) {
      const toRemove: PooledTexture[] = [];

      for (const pooled of bucket.textures) {
        if (!pooled.inUse) {
          toRemove.push(pooled);
        }
      }

      for (const pooled of toRemove) {
        const index = bucket.textures.indexOf(pooled);
        if (index !== -1) {
          bucket.textures.splice(index, 1);
          this.totalMemory -= estimateTextureMemory(
            pooled.texture.width,
            pooled.texture.height,
            pooled.texture.format
          );
          pooled.texture.dispose();

          const lruIndex = this.lruOrder.indexOf(pooled);
          if (lruIndex !== -1) {
            this.lruOrder.splice(lruIndex, 1);
          }
        }
      }
    }

    this.pooledCount = 0;

    // Clean up empty buckets
    for (const [key, bucket] of this.buckets) {
      if (bucket.textures.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * Clear all textures (including active ones - use with caution)
   */
  clearAll(): void {
    for (const bucket of this.buckets.values()) {
      for (const pooled of bucket.textures) {
        pooled.texture.dispose();
      }
    }

    this.buckets.clear();
    this.lruOrder = [];
    this.totalMemory = 0;
    this.activeCount = 0;
    this.pooledCount = 0;
  }

  /**
   * Get pool statistics
   */
  getStats(): TexturePoolStats {
    return {
      activeTextures: this.activeCount,
      pooledTextures: this.pooledCount,
      totalMemoryBytes: this.totalMemory,
    };
  }

  /**
   * Get memory usage as a formatted string
   */
  getMemoryUsageString(): string {
    const mb = this.totalMemory / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }

  /**
   * Evict textures if we're over limits
   */
  private evictIfNeeded(
    newWidth: number,
    newHeight: number,
    newFormat: TextureFormat
  ): void {
    const newMemory = estimateTextureMemory(newWidth, newHeight, newFormat);
    const totalTextures = this.activeCount + this.pooledCount;

    // Check if we need to evict
    const needsEviction =
      totalTextures >= this.options.maxTextures ||
      this.totalMemory + newMemory > this.options.maxMemoryBytes;

    if (!needsEviction) return;

    // Evict oldest unused textures until we have room
    const sorted = [...this.lruOrder]
      .filter((p) => !p.inUse)
      .sort((a, b) => a.lastUsed - b.lastUsed);

    for (const pooled of sorted) {
      if (
        this.pooledCount === 0 ||
        (totalTextures < this.options.maxTextures &&
          this.totalMemory + newMemory <= this.options.maxMemoryBytes)
      ) {
        break;
      }

      // Find and remove from bucket
      for (const bucket of this.buckets.values()) {
        const index = bucket.textures.indexOf(pooled);
        if (index !== -1) {
          bucket.textures.splice(index, 1);
          this.totalMemory -= estimateTextureMemory(
            pooled.texture.width,
            pooled.texture.height,
            pooled.texture.format
          );
          this.pooledCount--;
          pooled.texture.dispose();

          const lruIndex = this.lruOrder.indexOf(pooled);
          if (lruIndex !== -1) {
            this.lruOrder.splice(lruIndex, 1);
          }
          break;
        }
      }
    }
  }

  /**
   * Update LRU order for a texture
   */
  private updateLRU(pooled: PooledTexture): void {
    const index = this.lruOrder.indexOf(pooled);
    if (index !== -1) {
      this.lruOrder.splice(index, 1);
    }
    this.lruOrder.push(pooled);
  }
}
