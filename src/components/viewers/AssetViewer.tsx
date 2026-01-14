/**
 * AssetViewer Component
 *
 * A shared viewer component used by both SourceNode and OperationNode.
 * Handles proper aspect ratio display for any asset dimensions (portrait, landscape, square).
 */

import { useRef, useEffect, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// Checkerboard pattern size
const CHECKER_SIZE = 8;

/**
 * Draw a checkerboard pattern on a canvas (for loading placeholders)
 */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color1 = '#2a2a2a',
  color2 = '#3a3a3a'
): void {
  for (let y = 0; y < height; y += CHECKER_SIZE) {
    for (let x = 0; x < width; x += CHECKER_SIZE) {
      const isEven = ((x / CHECKER_SIZE) + (y / CHECKER_SIZE)) % 2 === 0;
      ctx.fillStyle = isEven ? color1 : color2;
      ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE);
    }
  }
}

// Default dimensions for empty/placeholder state
export const DEFAULT_VIEWER_WIDTH = 1080;
export const DEFAULT_VIEWER_HEIGHT = 1080;

interface AssetViewerProps {
  /** Canvas ref for rendering content */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Width of the asset in pixels (displayed at actual size) */
  width?: number;
  /** Height of the asset in pixels (displayed at actual size) */
  height?: number;
  /** Whether the viewer is in loading state */
  isLoading?: boolean;
  /** Loading progress (0-1) */
  loadingProgress?: number;
  /** Error message to display */
  error?: string | null;
  /** Whether there's no content to display (e.g., no upstream connection) */
  isEmpty?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Additional class names for the container */
  className?: string;
}

/**
 * Shared viewer component for displaying asset previews
 * Displays at full pixel resolution of the asset
 */
export function AssetViewer({
  canvasRef,
  width = DEFAULT_VIEWER_WIDTH,
  height = DEFAULT_VIEWER_HEIGHT,
  isLoading = false,
  loadingProgress,
  error,
  isEmpty = false,
  emptyMessage = 'No content',
  className,
}: AssetViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize canvas with checkerboard pattern as default background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions
    canvas.width = width;
    canvas.height = height;

    // Draw checkerboard as default background
    drawCheckerboard(ctx, width, height);
  }, [canvasRef, width, height]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative rounded overflow-hidden',
        className
      )}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {/* Canvas at full pixel resolution */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-full"
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          {loadingProgress !== undefined && (
            <span className="text-xs text-muted-foreground mt-1">
              {Math.round(loadingProgress * 100)}%
            </span>
          )}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && !isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60">
          <span className="text-xs">{emptyMessage}</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-red-400">
          <span className="text-xs">{error}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Initialize a canvas with checkerboard pattern at the given dimensions
 */
export function initializeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    drawCheckerboard(ctx, width, height);
  }
}
