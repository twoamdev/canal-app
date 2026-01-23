/**
 * OperationNode Component
 *
 * Unified operation node that handles blur, color_correct, and transform operations.
 * Shows preview with effects applied. Parameter controls are in the PropertiesPanel.
 */

import { useCallback, useRef, useEffect } from 'react';
import { Handle, Position, useViewport, useUpdateNodeInternals, useReactFlow } from '@xyflow/react';
import type { OperationNode, OperationType, TransformParams } from '../../types/scene-graph';
import { useGraphStore } from '../../stores/graphStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useEditModeStore } from '../../stores/editModeStore';
import { useLayerStore } from '../../stores/layerStore';
import { useAssetStore } from '../../stores/assetStore';
import { useCompositionStore } from '../../stores/compositionStore';
import { useChainRenderer } from '../../hooks/useChainRenderer';
import { findUpstreamChain, type SceneGraph } from '../../utils/scene-graph-utils';
import { calculateAccumulatedBounds } from '../../utils/transform-utils';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { CircleDot, Palette, Move } from 'lucide-react';
import { AssetViewer } from '../viewers';

// Handle size constant
const HANDLE_BASE_SIZE = 12;

// Operation type icons
const OPERATION_ICONS = {
  blur: CircleDot,
  color_correct: Palette,
  transform: Move,
};

// Operation type labels
const OPERATION_LABELS: Record<OperationType, string> = {
  blur: 'Blur',
  color_correct: 'Color Correct',
  transform: 'Transform',
};

const variantStyles = {
  ring: 'ring-border',
  ringSelected: 'ring-foreground',
  iconBg: 'bg-muted',
  iconText: 'text-muted-foreground',
};

interface OperationNodeComponentProps {
  id: string;
  data: OperationNode;
  selected?: boolean;
}

export function OperationNodeComponent(props: OperationNodeComponentProps) {
  const { id, data, selected } = props;
  const { operationType, isEnabled, label } = data;

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Chain renderer for preview
  const { isLoading, error, hasUpstream, dimensions } = useChainRenderer({
    nodeId: id,
    selected: selected ?? false,
    canvasRef,
  });

  // Stores
  const updateNode = useGraphStore((s) => s.updateNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const startConnection = useConnectionStore((s) => s.startConnection);
  const cancelConnection = useConnectionStore((s) => s.cancelConnection);
  const enterTransformEditMode = useEditModeStore((s) => s.enterTransformEditMode);
  const layers = useLayerStore((s) => s.layers);
  const assets = useAssetStore((s) => s.assets);
  const activeCompId = useCompositionStore((s) => s.activeCompositionId);
  const composition = useAssetStore((s) => {
    if (!activeCompId) return null;
    const asset = s.assets[activeCompId];
    return asset?.type === 'composition' ? asset : null;
  });

  // ReactFlow
  const { zoom } = useViewport();
  const { getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Get icon
  const IconComponent = OPERATION_ICONS[operationType] ?? CircleDot;

  // Update handle positions when zoom changes
  useEffect(() => {
    updateNodeInternals(id);
  }, [zoom, id, updateNodeInternals]);

  // Toggle enabled
  const toggleEnabled = useCallback(() => {
    updateNode(id, { isEnabled: !isEnabled });
  }, [id, isEnabled, updateNode]);

  // Handle click on input (target) handle
  const handleTargetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id) {
      addEdge({
        id: `edge_${Date.now()}`,
        source: activeConnection.nodeId,
        target: id,
        sourceHandle: null,
        targetHandle: null,
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

    const handleX = node.position.x + (node.measured?.width ?? 200) / 2;
    const handleY = node.position.y;

    startConnection({
      nodeId: id,
      handleType: 'target',
      handlePosition: Position.Top,
      x: handleX,
      y: handleY,
    });
  }, [id, activeConnection, startConnection, cancelConnection, getNode, addEdge]);

  // Handle click on output (source) handle
  const handleSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

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
      x: handleX,
      y: handleY,
    });
  }, [id, activeConnection, startConnection, cancelConnection, getNode, addEdge]);

  // Check if handles are valid drop targets
  const isValidSourceTarget = activeConnection?.handleType === 'target' && activeConnection?.nodeId !== id;
  const isValidTargetTarget = activeConnection?.handleType === 'source' && activeConnection?.nodeId !== id;

  // Handle click on viewer for transform nodes - enters edit mode
  const handleViewerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle for selected transform nodes
    if (!selected || operationType !== 'transform') return;
    if (!composition?.graph || !hasUpstream) return;

    e.stopPropagation();

    const sceneGraph: SceneGraph = {
      nodes: composition.graph.nodes,
      edges: composition.graph.edges,
    };

    // Find the upstream chain to get the source layer
    const chain = findUpstreamChain(sceneGraph, id);
    if (!chain.isComplete || !chain.sourceNode) return;

    // Get the source layer and asset
    const sourceLayer = layers[chain.sourceNode.layerId];
    if (!sourceLayer) return;

    const sourceAsset = assets[sourceLayer.assetId];
    if (!sourceAsset) return;

    // Layer dimensions (original size for dashed outline)
    const layerDimensions = {
      width: sourceAsset.intrinsicWidth,
      height: sourceAsset.intrinsicHeight,
    };

    // Collect all transform params from operations BEFORE this node in the chain
    const upstreamTransformParams: TransformParams[] = [];
    for (const op of chain.operationNodes) {
      if (op.id === id) break; // Stop at current node
      if (op.operationType === 'transform' && op.isEnabled) {
        upstreamTransformParams.push(op.params as TransformParams);
      }
    }

    // Calculate accumulated bounds from baseTransform + upstream transforms
    // This tells us the bounding box of the content as it arrives at this transform node
    const contentBounds = calculateAccumulatedBounds(
      sourceAsset.intrinsicWidth,
      sourceAsset.intrinsicHeight,
      sourceLayer.baseTransform,
      upstreamTransformParams
    );

    // Get the viewer's screen bounds (same approach as SourceNodeComponent)
    const viewerRect = e.currentTarget.getBoundingClientRect();

    // Find the node element to calculate viewer's offset from node position
    const nodeElement = e.currentTarget.closest('.react-flow__node');
    const nodeRect = nodeElement?.getBoundingClientRect();

    const viewerInfo = {
      // Offset of viewer from node's top-left corner (in current screen pixels)
      offsetX: nodeRect ? viewerRect.left - nodeRect.left : 0,
      offsetY: nodeRect ? viewerRect.top - nodeRect.top : 0,
      width: viewerRect.width,
      height: viewerRect.height,
      initialZoom: zoom,
    };

    enterTransformEditMode(id, id, viewerInfo, contentBounds, layerDimensions);
  }, [
    selected,
    operationType,
    composition,
    hasUpstream,
    id,
    layers,
    assets,
    zoom,
    enterTransformEditMode,
  ]);

  return (
    <Card
      className={cn(
        'min-w-[200px] p-4 transition-all duration-200 ring-2',
        selected ? variantStyles.ringSelected : variantStyles.ring,
        'hover:shadow-lg',
        !isEnabled && 'opacity-60'
      )}
    >
      {/* Input handle on top */}
      <Handle
        type="target"
        position={Position.Top}
        className={cn(
          '!bg-muted-foreground hover:!bg-foreground transition-colors cursor-pointer',
          isValidTargetTarget && '!bg-primary !scale-125'
        )}
        style={{
          width: HANDLE_BASE_SIZE / zoom,
          height: HANDLE_BASE_SIZE / zoom,
          top: -(HANDLE_BASE_SIZE / zoom),
        }}
        onClick={handleTargetClick}
      />

      {/* Node content */}
      <div className="flex flex-col gap-2">
        {/* Icon and label header */}
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded flex items-center justify-center', variantStyles.iconBg)}>
            <div className={variantStyles.iconText}>
              <IconComponent className="w-5 h-5" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">
              {label || OPERATION_LABELS[operationType]}
            </p>
          </div>
          {/* Enable/disable toggle */}
          <Switch
            checked={isEnabled}
            onCheckedChange={toggleEnabled}
            className="scale-75"
          />
        </div>

        {/* Preview canvas with effect chain applied */}
        <div
          onClick={handleViewerClick}
          className={cn(
            operationType === 'transform' && selected && hasUpstream && 'cursor-pointer'
          )}
        >
          <AssetViewer
            canvasRef={canvasRef}
            width={dimensions.width}
            height={dimensions.height}
            isLoading={isLoading && hasUpstream}
            error={error}
            isEmpty={!hasUpstream}
            emptyMessage="No input connected"
          />
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
