/**
 * SourceNode Component
 *
 * Unified source node that displays video, image, shape, or composition assets.
 * Shows preview and layer information.
 *
 * Features:
 * - Immediate display with checkerboard placeholder while loading
 * - Preserves previous frame during playback (no flickering)
 * - Shows progress during asset processing
 */

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import type { SourceNode } from '../../types/scene-graph';
import { useAssetStore } from '../../stores/assetStore';
import { useGraphStore } from '../../stores/graphStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { loadAssetFrame, mapGlobalFrameToSource, globalFrameCache } from '../../utils/asset-loader';
import {
  isVideoAsset,
  isImageAsset,
  isShapeAsset,
  isCompositionAsset,
  isAssetLoading,
  getAssetDimensions,
} from '../../types/assets';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { FileVideo, Image, Shapes, Layers, Loader2 } from 'lucide-react';

// Handle size constant
const HANDLE_BASE_SIZE = 12;

// Checkerboard pattern size
const CHECKER_SIZE = 8;

// Asset type icons
const ASSET_ICONS = {
  video: FileVideo,
  image: Image,
  shape: Shapes,
  composition: Layers,
};

// Asset type variants
const ASSET_VARIANTS = {
  video: 'primary',
  image: 'success',
  shape: 'warning',
  composition: 'default',
} as const;

const variantStyles = {
  default: {
    ring: 'ring-border',
    ringSelected: 'ring-foreground',
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
  },
  primary: {
    ring: 'ring-primary/30',
    ringSelected: 'ring-primary',
    iconBg: 'bg-primary/10',
    iconText: 'text-primary',
  },
  success: {
    ring: 'ring-green-500/30',
    ringSelected: 'ring-green-500',
    iconBg: 'bg-green-500/10',
    iconText: 'text-green-600',
  },
  warning: {
    ring: 'ring-yellow-500/30',
    ringSelected: 'ring-yellow-500',
    iconBg: 'bg-yellow-500/10',
    iconText: 'text-yellow-600',
  },
};

/**
 * Draw a checkerboard pattern on a canvas (for loading placeholders)
 */
function drawCheckerboard(
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

interface SourceNodeComponentProps {
  id: string;
  data: SourceNode;
  selected?: boolean;
}

export function SourceNodeComponent(props: SourceNodeComponentProps) {
  const { id, data, selected } = props;
  const { layer } = data;

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRenderedFrameRef = useRef<number | null>(null);
  const canvasDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const isInitialLoadRef = useRef(true);

  // State - only show loading on initial load, not during playback
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stores
  const assets = useAssetStore((s) => s.assets);
  // Only subscribe to frame changes when selected to avoid unnecessary re-renders
  const globalFrame = useTimelineStore((s) => s.currentFrame);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const startConnection = useConnectionStore((s) => s.startConnection);
  const cancelConnection = useConnectionStore((s) => s.cancelConnection);
  const addEdge = useGraphStore((s) => s.addEdge);

  // Only update current frame when selected OR not playing
  // This prevents all nodes from re-rendering during playback
  const currentFrame = (selected || !isPlaying) ? globalFrame : (lastRenderedFrameRef.current ?? 0);

  // ReactFlow
  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Get the asset
  const asset = useMemo(() => assets[layer.assetId], [assets, layer.assetId]);

  // Check if asset is still being processed
  const assetIsLoading = asset ? isAssetLoading(asset) : true;
  const loadingProgress = asset?.loadingState?.progress ?? 0;

  // Get asset type and dimensions
  const assetType = asset?.type ?? 'video';
  const dimensions = asset ? getAssetDimensions(asset) : { width: 320, height: 180 };
  const variant = ASSET_VARIANTS[assetType] ?? 'default';
  const styles = variantStyles[variant];
  const IconComponent = ASSET_ICONS[assetType] ?? FileVideo;

  // Update handle positions when zoom changes
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // Initialize canvas with proper dimensions (full resolution for quality)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to full asset resolution - CSS will handle display scaling
    if (!canvasDimensionsRef.current ||
        canvasDimensionsRef.current.width !== dimensions.width ||
        canvasDimensionsRef.current.height !== dimensions.height) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      canvasDimensionsRef.current = { width: dimensions.width, height: dimensions.height };

      // Draw initial checkerboard
      drawCheckerboard(ctx, dimensions.width, dimensions.height);
    }
  }, [dimensions]);

  // Render preview when frame changes
  useEffect(() => {
    if (!asset || !canvasRef.current) return;
    if (!isVideoAsset(asset) && !isImageAsset(asset)) return;

    // Don't try to load frames if asset is still being processed
    if (assetIsLoading) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        drawCheckerboard(ctx, canvas.width, canvas.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Map global frame to source frame
    const sourceFrame = mapGlobalFrameToSource(
      currentFrame,
      layer.timeRange,
      asset
    );

    // If null, layer is not active at this frame - show checkerboard
    if (sourceFrame === null) {
      drawCheckerboard(ctx, canvas.width, canvas.height);
      lastRenderedFrameRef.current = null;
      return;
    }

    // Skip if we already rendered this frame
    if (lastRenderedFrameRef.current === sourceFrame) {
      return;
    }

    // Check cache first - render immediately without async
    const cached = globalFrameCache.get(asset.id, sourceFrame);
    if (cached) {
      // Update canvas dimensions if needed (only if they've actually changed)
      if (canvas.width !== cached.width || canvas.height !== cached.height) {
        canvas.width = cached.width;
        canvas.height = cached.height;
        canvasDimensionsRef.current = { width: cached.width, height: cached.height };
      }
      ctx.drawImage(cached, 0, 0);
      lastRenderedFrameRef.current = sourceFrame;
      setInitialLoading(false);
      isInitialLoadRef.current = false;
      return;
    }

    // Load frame asynchronously - DON'T clear the canvas, keep the previous frame visible
    loadAssetFrame(asset, sourceFrame)
      .then((bitmap) => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Update canvas dimensions only if they've changed
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvasDimensionsRef.current = { width: bitmap.width, height: bitmap.height };
        }

        // Draw the frame
        ctx.drawImage(bitmap, 0, 0);

        // Cache the frame for future use
        globalFrameCache.set(asset.id, sourceFrame, bitmap);

        lastRenderedFrameRef.current = sourceFrame;
        setInitialLoading(false);
        isInitialLoadRef.current = false;
        setError(null);
      })
      .catch((err) => {
        console.error('Failed to load frame:', err);
        // Only show error on initial load, not during playback
        if (isInitialLoadRef.current) {
          setError('Failed to load frame');
        }
      });
  }, [asset, assetIsLoading, currentFrame, layer.timeRange]);

  // Handle click on output (source) handle
  const handleSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // If there's an active connection from a target handle, complete the connection
    if (activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id) {
      addEdge({
        id: `edge_${Date.now()}`,
        source: id,
        target: activeConnection.nodeId,
        sourceHandle: null,
        targetHandle: null,
      });
      cancelConnection();
      return;
    }

    // If already connecting from this handle, cancel
    if (activeConnection?.nodeId === id && activeConnection?.handleType === 'source') {
      cancelConnection();
      return;
    }

    // Start new connection
    if (activeConnection?.handleType === 'source') {
      cancelConnection();
    }

    const node = getNode(id);
    if (!node) return;

    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y + (node.measured?.height ?? 100);

    startConnection({
      nodeId: id,
      handleType: 'source',
      handlePosition: Position.Bottom,
      x: handleX,
      y: handleY,
    });
  }, [id, activeConnection, startConnection, cancelConnection, getNode, addEdge]);

  // Check if this handle is a valid drop target
  const isValidSourceTarget = activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id;

  // Render shape preview
  const renderShapePreview = () => {
    if (!asset || !isShapeAsset(asset)) return null;

    const { pathData, fillColor, strokeColor, strokeWidth, fillRule } = asset.metadata;

    return (
      <div className="relative rounded overflow-hidden bg-black aspect-video flex items-center justify-center">
        <svg
          viewBox={`0 0 ${asset.intrinsicWidth} ${asset.intrinsicHeight}`}
          className="w-full h-full"
        >
          <path
            d={pathData}
            fill={fillColor ?? '#ffffff'}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fillRule={fillRule}
          />
        </svg>
      </div>
    );
  };

  // Render composition preview (placeholder for now)
  const renderCompositionPreview = () => {
    if (!asset || !isCompositionAsset(asset)) return null;

    return (
      <div className="relative rounded overflow-hidden bg-muted aspect-video flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Layers className="w-8 h-8 mx-auto mb-1 opacity-50" />
          <span className="text-xs">Composition</span>
        </div>
      </div>
    );
  };

  // Render loading indicator for asset processing
  const renderAssetProcessing = () => {
    return (
      <div className="relative rounded overflow-hidden bg-muted aspect-video">
        <canvas ref={canvasRef} className="w-full h-auto opacity-50" />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-2" />
          <span className="text-xs text-muted-foreground">
            Processing... {Math.round(loadingProgress * 100)}%
          </span>
        </div>
      </div>
    );
  };

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? styles.ringSelected : styles.ring,
        'hover:shadow-lg'
      )}
    >
      {/* No input handle for source nodes */}

      {/* Node content */}
      <div className="flex flex-col gap-2">
        {/* Icon and label header */}
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded flex items-center justify-center', styles.iconBg)}>
            <div className={styles.iconText}>
              <IconComponent className="w-5 h-5" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">
              {layer.name || asset?.name || 'Source'}
            </p>
            {dimensions && !assetIsLoading && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {dimensions.width} × {dimensions.height}
              </p>
            )}
            {assetIsLoading && (
              <p className="text-xs text-muted-foreground">
                Processing...
              </p>
            )}
          </div>
        </div>

        {/* Preview content */}
        <div className="text-xs text-muted-foreground">
          {/* Asset processing state */}
          {assetIsLoading && renderAssetProcessing()}

          {/* Video/Image preview (only when asset is ready) */}
          {!assetIsLoading && (isVideoAsset(asset) || isImageAsset(asset)) && (
            <div className="relative rounded overflow-hidden bg-black">
              <canvas
                ref={canvasRef}
                className="w-full h-auto"
              />
              {/* Only show loading overlay on initial load */}
              {initialLoading && !assetIsLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <span className="text-xs">Loading...</span>
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-red-400">
                  <span className="text-xs">{error}</span>
                </div>
              )}
            </div>
          )}

          {/* Shape preview */}
          {!assetIsLoading && isShapeAsset(asset) && renderShapePreview()}

          {/* Composition preview */}
          {!assetIsLoading && isCompositionAsset(asset) && renderCompositionPreview()}

          {/* No asset message */}
          {!asset && (
            <div className="py-4 text-center text-muted-foreground/60 border border-dashed border-muted rounded">
              Asset not found
            </div>
          )}
        </div>
      </div>

      {/* Output handle on bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          '!bg-muted-foreground hover:!bg-foreground transition-colors cursor-pointer',
          isValidSourceTarget && '!bg-primary !scale-125'
        )}
        style={{
          width: HANDLE_BASE_SIZE / zoom,
          height: HANDLE_BASE_SIZE / zoom,
          bottom: -(HANDLE_BASE_SIZE / zoom),
        }}
        onClick={handleSourceClick}
      />
    </Card>
  );
}
