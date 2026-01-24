/**
 * SourceNode Component
 *
 * Source node that displays video, image, shape, or composition assets.
 * Shows preview and layer information.
 *
 * Features:
 * - Immediate display with checkerboard placeholder while loading
 * - Preserves previous frame during playback (no flickering)
 * - Shows progress during asset processing
 */

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import type { SourceNode } from '../../types/scene-graph';
import { useAssetStore } from '../../stores/assetStore';
import { useLayerStore } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useEditModeStore } from '../../stores/editModeStore';
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
import { FileVideo, Image, Shapes, Layers } from 'lucide-react';
import { AssetViewer, drawCheckerboard, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT } from '../viewers';
import { BaseNodeComponent, type NodeVariant } from './BaseNodeComponent';

// Asset type icons
const ASSET_ICONS = {
  video: FileVideo,
  image: Image,
  shape: Shapes,
  composition: Layers,
};

// Asset type variants
const ASSET_VARIANTS: Record<string, NodeVariant> = {
  video: 'default',
  image: 'default',
  shape: 'default',
  composition: 'default',
};

interface SourceNodeComponentProps {
  id: string;
  data: SourceNode;
  selected?: boolean;
}

export function SourceNodeComponent({ id, data, selected }: SourceNodeComponentProps) {
  // Fetch layer from LayerStore
  const layer = useLayerStore((s) => s.layers[data.layerId]);

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
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const enterEditMode = useEditModeStore((s) => s.enterEditMode);

  // ReactFlow
  const { zoom } = useViewport();

  // Optimized frame subscription:
  // - Selected nodes subscribe to currentFrame for real-time updates
  // - Unselected nodes only subscribe to pauseTrigger to update when playback stops
  const pauseTrigger = useTimelineStore((s) => s.pauseTrigger);
  const globalFrame = useTimelineStore((s) => selected ? s.currentFrame : null);

  // Determine the frame to render
  const currentFrame = useMemo(() => {
    if (selected && globalFrame !== null) {
      return globalFrame;
    }
    return useTimelineStore.getState().currentFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, globalFrame, pauseTrigger]);

  // Early return if layer not found
  if (!layer) {
    return (
      <Card className="min-w-[200px] p-4 ring-2 ring-destructive/50">
        <div className="text-center text-muted-foreground py-4">
          <p className="text-sm">Layer not found</p>
          <p className="text-xs opacity-60">{data.layerId}</p>
        </div>
      </Card>
    );
  }

  // Get the asset
  const asset = assets[layer.assetId];

  // Check if asset is still being processed
  const assetIsLoading = asset ? isAssetLoading(asset) : true;
  const loadingProgress = asset?.loadingState?.progress ?? 0;

  // Get asset type and dimensions
  const assetType = asset?.type ?? 'video';
  const dimensions = asset ? getAssetDimensions(asset) : { width: DEFAULT_VIEWER_WIDTH, height: DEFAULT_VIEWER_HEIGHT };
  const variant = ASSET_VARIANTS[assetType] ?? 'default';
  const IconComponent = ASSET_ICONS[assetType] ?? FileVideo;

  // Initialize canvas with proper dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!canvasDimensionsRef.current ||
        canvasDimensionsRef.current.width !== dimensions.width ||
        canvasDimensionsRef.current.height !== dimensions.height) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      canvasDimensionsRef.current = { width: dimensions.width, height: dimensions.height };
      drawCheckerboard(ctx, dimensions.width, dimensions.height);
    }
  }, [dimensions]);

  // Render preview when frame changes
  useEffect(() => {
    if (!asset || !canvasRef.current) return;
    if (!isVideoAsset(asset) && !isImageAsset(asset)) return;

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

    const sourceFrame = mapGlobalFrameToSource(currentFrame, layer.timeRange, asset);

    if (sourceFrame === null) {
      drawCheckerboard(ctx, canvas.width, canvas.height);
      lastRenderedFrameRef.current = null;
      return;
    }

    if (lastRenderedFrameRef.current === sourceFrame) {
      return;
    }

    const cached = globalFrameCache.get(asset.id, sourceFrame);
    if (cached) {
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

    loadAssetFrame(asset, sourceFrame)
      .then((bitmap) => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvasDimensionsRef.current = { width: bitmap.width, height: bitmap.height };
        }

        ctx.drawImage(bitmap, 0, 0);
        globalFrameCache.set(asset.id, sourceFrame, bitmap);
        lastRenderedFrameRef.current = sourceFrame;
        setInitialLoading(false);
        isInitialLoadRef.current = false;
        setError(null);
      })
      .catch((err) => {
        console.error('Failed to load frame:', err);
        if (isInitialLoadRef.current) {
          setError('Failed to load frame');
        }
      });
  }, [asset, assetIsLoading, currentFrame, layer.timeRange]);

  // Edit mode - click on viewer when selected to enter edit mode
  const handleViewerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!selected) return;

    e.stopPropagation();

    const viewerRect = e.currentTarget.getBoundingClientRect();
    const nodeElement = e.currentTarget.closest('.react-flow__node');
    const nodeRect = nodeElement?.getBoundingClientRect();

    const viewerInfo = {
      offsetX: nodeRect ? viewerRect.left - nodeRect.left : 0,
      offsetY: nodeRect ? viewerRect.top - nodeRect.top : 0,
      width: viewerRect.width,
      height: viewerRect.height,
      initialZoom: zoom,
    };

    enterEditMode(id, data.layerId, viewerInfo);
  }, [selected, id, data.layerId, enterEditMode, zoom]);

  // Render shape preview SVG
  const renderShapePreview = () => {
    if (!asset || !isShapeAsset(asset)) return null;

    const { pathData, fillColor, strokeColor, strokeWidth, fillRule, paths } = asset.metadata;
    const width = asset.intrinsicWidth;
    const height = asset.intrinsicHeight;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
        {paths && paths.length > 0 ? (
          paths.map((p, i) => (
            <path
              key={i}
              d={p.pathData}
              fill={p.fillColor ?? 'none'}
              fillOpacity={p.fillOpacity}
              fillRule={p.fillRule}
              stroke={p.strokeColor}
              strokeWidth={p.strokeWidth}
              strokeOpacity={p.strokeOpacity}
              strokeLinecap={p.strokeLinecap}
              strokeLinejoin={p.strokeLinejoin}
              strokeMiterlimit={p.strokeMiterlimit}
              strokeDasharray={p.strokeDasharray?.join(' ')}
              strokeDashoffset={p.strokeDashoffset}
            />
          ))
        ) : (
          <path
            d={pathData}
            fill={fillColor ?? '#ffffff'}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fillRule={fillRule}
          />
        )}
      </svg>
    );
  };

  // Render composition preview
  const renderCompositionPreview = () => {
    if (!asset || !isCompositionAsset(asset)) return null;

    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Layers className="w-8 h-8 mx-auto mb-1 opacity-50" />
          <span className="text-xs">Composition</span>
        </div>
      </div>
    );
  };

  // Build sub-label (dimensions or processing state)
  const subLabel = assetIsLoading
    ? 'Processing...'
    : `${dimensions.width} × ${dimensions.height}`;

  // Handle label change
  const handleLabelChange = useCallback((newLabel: string) => {
    updateLayer(layer.id, { name: newLabel });
  }, [layer.id, updateLayer]);

  return (
    <BaseNodeComponent
      id={id}
      selected={selected}
      hasInputHandle={false}
      hasOutputHandle={true}
      icon={IconComponent}
      label={layer.name || asset?.name || 'Source'}
      subLabel={subLabel}
      variant={variant}
      onViewerClick={handleViewerClick}
      viewerClickable={true}
      onLabelChange={handleLabelChange}
    >
      {/* Preview content with transform applied */}
      <div
        className={cn(
          'text-xs text-muted-foreground overflow-hidden transition-all relative',
          selected && 'ring-2 ring-primary/30 hover:ring-primary/50'
        )}
        style={{
          width: dimensions.width,
          height: dimensions.height,
        }}
      >
        {/* Checkerboard background for transparency */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-conic-gradient(#2a2a2a 0% 25%, #3a3a3a 0% 50%)`,
            backgroundSize: '16px 16px',
          }}
        />

        {/* Transformed content wrapper - applies layer.baseTransform */}
        <div
          className="absolute"
          style={{
            width: dimensions.width,
            height: dimensions.height,
            transform: `
              translate(${layer.baseTransform.position.x}px, ${layer.baseTransform.position.y}px)
              scale(${layer.baseTransform.scale.x}, ${layer.baseTransform.scale.y})
              rotate(${layer.baseTransform.rotation}deg)
            `,
            transformOrigin: `${layer.baseTransform.anchorPoint.x * 100}% ${layer.baseTransform.anchorPoint.y * 100}%`,
          }}
        >
          {/* Asset processing state */}
          {assetIsLoading && (
            <AssetViewer
              canvasRef={canvasRef}
              width={dimensions.width}
              height={dimensions.height}
              isLoading={true}
              loadingProgress={loadingProgress}
            />
          )}

          {/* Video/Image preview */}
          {!assetIsLoading && (isVideoAsset(asset) || isImageAsset(asset)) && (
            <AssetViewer
              canvasRef={canvasRef}
              width={dimensions.width}
              height={dimensions.height}
              isLoading={initialLoading}
              error={error}
            />
          )}

          {/* Shape preview */}
          {!assetIsLoading && isShapeAsset(asset) && renderShapePreview()}

          {/* Composition preview */}
          {!assetIsLoading && isCompositionAsset(asset) && renderCompositionPreview()}
        </div>

        {/* No asset message */}
        {!asset && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60 border border-dashed border-muted rounded">
            Asset not found
          </div>
        )}
      </div>
    </BaseNodeComponent>
  );
}
