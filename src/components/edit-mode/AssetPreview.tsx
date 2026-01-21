/**
 * AssetPreview
 *
 * Renders a preview of an asset in the edit mode canvas.
 * Supports video (shows current frame), image, and shape assets.
 */

import { useRef, useEffect, useState } from 'react';
import type { Asset } from '../../types/assets';
import { isVideoAsset, isImageAsset, isShapeAsset } from '../../types/assets';
import { useTimelineStore } from '../../stores/timelineStore';
import { globalFrameCache } from '../../utils/asset-loader';
import { opfsManager } from '../../utils/opfs';

interface AssetPreviewProps {
  asset: Asset;
}

export function AssetPreview({ asset }: AssetPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  // For video assets, load the current frame
  useEffect(() => {
    if (!isVideoAsset(asset)) return;

    const loadFrame = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas dimensions
      canvas.width = asset.intrinsicWidth;
      canvas.height = asset.intrinsicHeight;

      // Draw checkerboard background
      drawCheckerboard(ctx, asset.intrinsicWidth, asset.intrinsicHeight);

      // Try to get frame from cache
      const frameIndex = Math.min(currentFrame, (asset.metadata.frameCount || 1) - 1);
      const cachedFrame = globalFrameCache.get(asset.id, frameIndex);

      if (cachedFrame) {
        ctx.drawImage(cachedFrame, 0, 0, asset.intrinsicWidth, asset.intrinsicHeight);
      }
    };

    loadFrame();
  }, [asset, currentFrame]);

  // For image assets, load from OPFS
  useEffect(() => {
    if (!isImageAsset(asset)) return;

    const loadImage = async () => {
      try {
        const file = await opfsManager.getFile(asset.metadata.fileHandleId);
        if (file) {
          const url = URL.createObjectURL(file);
          setImageUrl(url);
          return () => URL.revokeObjectURL(url);
        }
      } catch (error) {
        console.error('Failed to load image:', error);
      }
    };

    loadImage();
  }, [asset]);

  // Render video asset
  if (isVideoAsset(asset)) {
    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{ imageRendering: 'auto' }}
      />
    );
  }

  // Render image asset
  if (isImageAsset(asset)) {
    return (
      <div className="w-full h-full bg-neutral-800">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={asset.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </div>
    );
  }

  // Render shape asset (SVG)
  if (isShapeAsset(asset)) {
    const { metadata } = asset;
    const width = asset.intrinsicWidth;
    const height = asset.intrinsicHeight;

    // Render multiple paths if available
    if (metadata.paths && metadata.paths.length > 0) {
      return (
        <div
          className="w-full h-full"
          style={{
            background: `
              repeating-conic-gradient(
                #808080 0% 25%,
                transparent 0% 50%
              ) 50% / 16px 16px
            `,
          }}
        >
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
            {metadata.paths.map((path, index) => (
              <path
                key={index}
                d={path.pathData}
                fill={path.fillColor ?? 'none'}
                fillOpacity={path.fillOpacity ?? 1}
                fillRule={path.fillRule ?? 'nonzero'}
                stroke={path.strokeColor ?? 'none'}
                strokeWidth={path.strokeWidth ?? 0}
                strokeOpacity={path.strokeOpacity ?? 1}
                strokeLinecap={path.strokeLinecap}
                strokeLinejoin={path.strokeLinejoin}
                strokeMiterlimit={path.strokeMiterlimit}
              />
            ))}
          </svg>
        </div>
      );
    }

    // Single path fallback
    return (
      <div
        className="w-full h-full"
        style={{
          background: `
            repeating-conic-gradient(
              #808080 0% 25%,
              transparent 0% 50%
            ) 50% / 16px 16px
          `,
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
          <path
            d={metadata.pathData}
            fill={metadata.fillColor ?? '#ffffff'}
            fillOpacity={metadata.fillOpacity ?? 1}
            fillRule={metadata.fillRule ?? 'nonzero'}
            stroke={metadata.strokeColor ?? 'none'}
            strokeWidth={metadata.strokeWidth ?? 0}
            strokeOpacity={metadata.strokeOpacity ?? 1}
          />
        </svg>
      </div>
    );
  }

  // Fallback for unsupported asset types
  return (
    <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-muted-foreground">
      Unsupported asset type
    </div>
  );
}

/**
 * Draw a checkerboard pattern on a canvas
 */
function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  size = 8,
  color1 = '#2a2a2a',
  color2 = '#3a3a3a'
): void {
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const isEven = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
      ctx.fillStyle = isEven ? color1 : color2;
      ctx.fillRect(x, y, size, size);
    }
  }
}
