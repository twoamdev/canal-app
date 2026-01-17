/**
 * GroupNode Component
 *
 * A node that combines multiple layers/groups with z-order control.
 * Displays the composited result of all connected inputs.
 *
 * Features:
 * - Dynamic input handles that spawn as connections are made
 * - Handle order determines layer order (left = bottom, right = top)
 * - Renders composited preview of all connected layers
 */

import { useCallback, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import type { GroupNode, SourceNode } from '../../types/scene-graph';
import { useGraphStore } from '../../stores/graphStore';
import { useGroupStore } from '../../stores/groupStore';
import { useLayerStore } from '../../stores/layerStore';
import { useAssetStore } from '../../stores/assetStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useCompositionStore } from '../../stores/compositionStore';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Layers, FolderOpen } from 'lucide-react';
import { AssetViewer, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT, drawCheckerboard } from '../viewers';
import { isShapeAsset, isVideoAsset, isImageAsset, isCompositionAsset, type ShapeAsset } from '../../types/assets';
import { getFrame } from '../../utils/frame-storage';
import { opfsManager } from '../../utils/opfs';
import { useTimelineStore } from '../../stores/timelineStore';

// Handle size constant
const HANDLE_BASE_SIZE = 12;
const HANDLE_SPACING = 24; // Space between handles

const variantStyles = {
  ring: 'ring-purple-500/30',
  ringSelected: 'ring-purple-500',
  iconBg: 'bg-purple-500/10',
  iconText: 'text-purple-600',
};

interface GroupNodeComponentProps {
  id: string;
  data: GroupNode;
  selected?: boolean;
}

export function GroupNodeComponent(props: GroupNodeComponentProps) {
  const { id, data, selected } = props;
  const { groupId, label } = data;

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Stores
  const group = useGroupStore((s) => s.groups[groupId]);
  const setMembers = useGroupStore((s) => s.setMembers);
  const activeCompositionId = useCompositionStore((s) => s.activeCompositionId);
  const compositionAsset = useAssetStore((s) =>
    activeCompositionId ? s.assets[activeCompositionId] : null
  );
  const layers = useLayerStore((s) => s.layers);
  const assets = useAssetStore((s) => s.assets);
  const addEdge = useGraphStore((s) => s.addEdge);
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const startConnection = useConnectionStore((s) => s.startConnection);
  const cancelConnection = useConnectionStore((s) => s.cancelConnection);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  // Get graph from composition asset (stable reference)
  const sceneGraph = useMemo(() => {
    if (!compositionAsset || !isCompositionAsset(compositionAsset)) return null;
    return compositionAsset.graph;
  }, [compositionAsset]);

  // Extract edges and nodes from scene graph
  const graphEdges = sceneGraph?.edges ?? [];
  const graphNodes = sceneGraph?.nodes ?? {};

  // ReactFlow
  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Get incoming edges to this node, sorted by targetHandle
  const incomingEdges = useMemo(() => {
    return graphEdges
      .filter((edge) => edge.target === id)
      .sort((a, b) => {
        // Sort by handle index (input-0, input-1, etc.)
        const aIndex = parseInt(a.targetHandle?.replace('input-', '') ?? '0', 10);
        const bIndex = parseInt(b.targetHandle?.replace('input-', '') ?? '0', 10);
        return aIndex - bIndex;
      });
  }, [graphEdges, id]);

  // Determine how many handles to show:
  // - At least 1 handle always
  // - 1 more handle than the highest connected handle index
  const handleCount = useMemo(() => {
    if (incomingEdges.length === 0) return 1;

    // Find the highest handle index that's connected
    let maxIndex = 0;
    for (const edge of incomingEdges) {
      const handleIndex = parseInt(edge.targetHandle?.replace('input-', '') ?? '0', 10);
      maxIndex = Math.max(maxIndex, handleIndex);
    }

    // Show one more handle than the highest connected
    return maxIndex + 2;
  }, [incomingEdges]);

  // Connected handle indices
  const connectedHandles = useMemo(() => {
    const connected = new Set<number>();
    for (const edge of incomingEdges) {
      const handleIndex = parseInt(edge.targetHandle?.replace('input-', '') ?? '0', 10);
      connected.add(handleIndex);
    }
    return connected;
  }, [incomingEdges]);

  // Update Group.memberIds when connections change
  useEffect(() => {
    if (!group) return;

    // Build memberIds from connected source nodes in handle order
    const memberIds: string[] = [];

    for (const edge of incomingEdges) {
      const sourceNode = graphNodes[edge.source];
      if (!sourceNode) continue;

      if (sourceNode.type === 'source') {
        // SourceNode - get layerId
        memberIds.push((sourceNode as SourceNode).layerId);
      } else if (sourceNode.type === 'group') {
        // Nested GroupNode - get groupId
        memberIds.push((sourceNode as GroupNode).groupId);
      }
    }

    // Only update if memberIds actually changed
    const currentIds = group.memberIds.join(',');
    const newIds = memberIds.join(',');
    if (currentIds !== newIds) {
      setMembers(groupId, memberIds);
      console.log(`[GroupNode] Updated memberIds for ${groupId}:`, memberIds);
    }
  }, [incomingEdges, graphNodes, group, groupId, setMembers]);

  // Update handle positions when zoom or handle count changes
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, handleCount, updateNodeInternals]);

  // Helper to render a shape asset to a canvas context
  const renderShapeToContext = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, shapeAsset: ShapeAsset) => {
    const { pathData, fillColor, strokeColor, strokeWidth, fillRule, paths } = shapeAsset.metadata;

    if (paths && paths.length > 0) {
      // Multi-path SVG: render each path with its own style
      for (const p of paths) {
        const path2D = new Path2D(p.pathData);
        if (p.fillColor && p.fillColor !== 'none') {
          ctx.fillStyle = p.fillColor;
          ctx.globalAlpha = p.fillOpacity ?? 1;
          ctx.fill(path2D, p.fillRule ?? 'nonzero');
          ctx.globalAlpha = 1;
        }
        if (p.strokeColor && p.strokeColor !== 'none' && p.strokeWidth) {
          ctx.strokeStyle = p.strokeColor;
          ctx.lineWidth = p.strokeWidth;
          ctx.globalAlpha = p.strokeOpacity ?? 1;
          ctx.stroke(path2D);
          ctx.globalAlpha = 1;
        }
      }
    } else if (pathData) {
      // Single path
      const path2D = new Path2D(pathData);
      if (fillColor && fillColor !== 'none') {
        ctx.fillStyle = fillColor;
        ctx.fill(path2D, fillRule ?? 'nonzero');
      }
      if (strokeColor && strokeColor !== 'none' && strokeWidth) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke(path2D);
      }
    }
  };

  // Render composited preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = DEFAULT_VIEWER_WIDTH;
    canvas.height = DEFAULT_VIEWER_HEIGHT;

    // Start with checkerboard
    drawCheckerboard(ctx, DEFAULT_VIEWER_WIDTH, DEFAULT_VIEWER_HEIGHT);

    if (!group || group.memberIds.length === 0) return;

    // Calculate combined bounds of all members to determine scale
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    let hasAnyContent = false;

    for (const memberId of group.memberIds) {
      const layer = layers[memberId];
      if (layer) {
        const asset = assets[layer.assetId];
        if (!asset) continue;

        const x = layer.baseTransform.position?.x ?? 0;
        const y = layer.baseTransform.position?.y ?? 0;

        if (!hasAnyContent) {
          minX = x;
          minY = y;
          maxX = x + asset.intrinsicWidth;
          maxY = y + asset.intrinsicHeight;
          hasAnyContent = true;
        } else {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + asset.intrinsicWidth);
          maxY = Math.max(maxY, y + asset.intrinsicHeight);
        }
      }
    }

    if (!hasAnyContent) return;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    // Calculate scale to fit content in viewer
    const scaleX = DEFAULT_VIEWER_WIDTH / contentWidth;
    const scaleY = DEFAULT_VIEWER_HEIGHT / contentHeight;
    const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to add some padding

    // Center offset
    const offsetX = (DEFAULT_VIEWER_WIDTH - contentWidth * scale) / 2 - minX * scale;
    const offsetY = (DEFAULT_VIEWER_HEIGHT - contentHeight * scale) / 2 - minY * scale;

    // Render each member in order (first = bottom, last = top)
    const renderMembers = async () => {
      for (const memberId of group.memberIds) {
        // Check if it's a layer
        const layer = layers[memberId];
        if (layer) {
          const asset = assets[layer.assetId];
          if (!asset) continue;

          // Apply layer position
          const layerX = (layer.baseTransform.position?.x ?? 0) * scale + offsetX;
          const layerY = (layer.baseTransform.position?.y ?? 0) * scale + offsetY;

          if (isShapeAsset(asset)) {
            // Render shape using Path2D
            const offscreen = new OffscreenCanvas(asset.intrinsicWidth, asset.intrinsicHeight);
            const offCtx = offscreen.getContext('2d');
            if (offCtx) {
              renderShapeToContext(offCtx, asset);
              ctx.drawImage(
                offscreen,
                layerX,
                layerY,
                asset.intrinsicWidth * scale,
                asset.intrinsicHeight * scale
              );
            }
          } else if (isImageAsset(asset)) {
            // Load image from OPFS
            try {
              const file = await opfsManager.getFile(asset.metadata.fileHandleId);
              const bitmap = await createImageBitmap(file);
              ctx.drawImage(
                bitmap,
                layerX,
                layerY,
                asset.intrinsicWidth * scale,
                asset.intrinsicHeight * scale
              );
              bitmap.close();
            } catch (err) {
              // Failed to load image, skip
            }
          } else if (isVideoAsset(asset)) {
            // Load video frame from OPFS
            try {
              const format = asset.metadata.extractedFrameFormat ?? 'webp';
              const bitmap = await getFrame(asset.metadata.fileHandleId, currentFrame, format);
              ctx.drawImage(
                bitmap,
                layerX,
                layerY,
                asset.intrinsicWidth * scale,
                asset.intrinsicHeight * scale
              );
              bitmap.close();
            } catch (err) {
              // Failed to load frame, skip
            }
          }
        }
        // TODO: Handle nested groups (recursively render)
      }
    };

    renderMembers();
  }, [group, layers, assets, currentFrame]);

  // Handle click on a specific input handle
  const handleTargetClick = useCallback(
    (handleId: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id) {
        // Complete the connection
        addEdge({
          id: `edge_${Date.now()}`,
          source: activeConnection.nodeId,
          target: id,
          sourceHandle: activeConnection.handleId,
          targetHandle: handleId,
        });
        cancelConnection();
        return;
      }

      if (activeConnection?.nodeId === id && activeConnection?.handleType === 'target') {
        cancelConnection();
        return;
      }

      if (activeConnection?.handleType === 'target') {
        cancelConnection();
      }

      const node = getNode(id);
      if (!node) return;

      // Calculate handle position
      const handleIndex = parseInt(handleId.replace('input-', ''), 10);
      const totalWidth = (handleCount - 1) * HANDLE_SPACING;
      const startX = -totalWidth / 2;
      const handleOffsetX = startX + handleIndex * HANDLE_SPACING;

      const handleX = node.position.x + (node.measured?.width ?? 200) / 2 + handleOffsetX;
      const handleY = node.position.y;

      startConnection({
        nodeId: id,
        handleType: 'target',
        handlePosition: Position.Top,
        handleId,
        x: handleX,
        y: handleY,
      });
    },
    [id, activeConnection, startConnection, cancelConnection, getNode, addEdge, handleCount]
  );

  // Handle click on output (source) handle
  const handleSourceClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id) {
        addEdge({
          id: `edge_${Date.now()}`,
          source: id,
          target: activeConnection.nodeId,
          sourceHandle: 'output',
          targetHandle: activeConnection.handleId,
        });
        cancelConnection();
        return;
      }

      if (activeConnection?.nodeId === id && activeConnection?.handleType === 'source') {
        cancelConnection();
        return;
      }

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
        handleId: 'output',
        x: handleX,
        y: handleY,
      });
    },
    [id, activeConnection, startConnection, cancelConnection, getNode, addEdge]
  );

  // Check if we're in connection mode for styling
  const isValidTargetForConnection = activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id;
  const isValidSourceTarget = activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id;

  // Get member count
  const memberCount = group?.memberIds.length ?? 0;

  // Early return if group not found
  if (!group) {
    return (
      <Card className="min-w-[200px] p-4 ring-2 ring-destructive/50">
        <div className="text-center text-muted-foreground py-4">
          <p className="text-sm">Group not found</p>
          <p className="text-xs opacity-60">{groupId}</p>
        </div>
      </Card>
    );
  }

  // Calculate handle positions for horizontal layout
  const totalHandleWidth = (handleCount - 1) * HANDLE_SPACING;
  const handleStartOffset = -totalHandleWidth / 2;

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? variantStyles.ringSelected : variantStyles.ring,
        'hover:shadow-lg'
      )}
    >
      {/* Dynamic input handles on top */}
      {Array.from({ length: handleCount }, (_, index) => {
        const handleId = `input-${index}`;
        const isConnected = connectedHandles.has(index);
        const offsetX = handleStartOffset + index * HANDLE_SPACING;

        return (
          <Handle
            key={handleId}
            id={handleId}
            type="target"
            position={Position.Top}
            className={cn(
              '!bg-muted-foreground hover:!bg-foreground transition-colors cursor-pointer',
              isValidTargetForConnection && !isConnected && '!bg-primary !scale-125',
              isConnected && '!bg-green-500'
            )}
            style={{
              width: HANDLE_BASE_SIZE / zoom,
              height: HANDLE_BASE_SIZE / zoom,
              top: -(HANDLE_BASE_SIZE / zoom),
              left: `calc(50% + ${offsetX}px)`,
              transform: 'translateX(-50%)',
            }}
            onClick={handleTargetClick(handleId)}
          />
        );
      })}

      {/* Node content */}
      <div className="flex flex-col gap-2">
        {/* Icon and label header */}
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded flex items-center justify-center', variantStyles.iconBg)}>
            <div className={variantStyles.iconText}>
              {memberCount > 0 ? <Layers className="w-5 h-5" /> : <FolderOpen className="w-5 h-5" />}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">{label || group.name || 'Group'}</p>
            <p className="text-xs text-muted-foreground">
              {memberCount} {memberCount === 1 ? 'layer' : 'layers'}
            </p>
          </div>
        </div>

        {/* Handle order legend */}
        {handleCount > 1 && (
          <div className="flex justify-between text-[10px] text-muted-foreground px-1">
            <span>bg</span>
            <span>fg</span>
          </div>
        )}

        {/* Preview canvas */}
        <AssetViewer
          canvasRef={canvasRef}
          width={DEFAULT_VIEWER_WIDTH}
          height={DEFAULT_VIEWER_HEIGHT}
          isLoading={false}
          isEmpty={memberCount === 0}
          emptyMessage="Connect sources to group"
        />
      </div>

      {/* Output handle on bottom */}
      <Handle
        id="output"
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
