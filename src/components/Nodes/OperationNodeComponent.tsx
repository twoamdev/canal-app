/**
 * OperationNode Component
 *
 * Operation node that handles blur, color_correct, and transform operations.
 * Shows preview with effects applied. Parameter controls are in the PropertiesPanel.
 */

import { useCallback, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import type { OperationNode, OperationType, TransformParams } from '../../types/scene-graph';
import { useGraphStore } from '../../stores/graphStore';
import { useEditModeStore } from '../../stores/editModeStore';
import { useLayerStore } from '../../stores/layerStore';
import { useAssetStore } from '../../stores/assetStore';
import { useCompositionStore } from '../../stores/compositionStore';
import { useChainRenderer } from '../../hooks/useChainRenderer';
import { findUpstreamChain, type SceneGraph } from '../../utils/scene-graph-utils';
import { calculateAccumulatedBounds } from '../../utils/transform-utils';
import { Switch } from '@/components/ui/switch';
import { CircleDot, Palette, Move } from 'lucide-react';
import { AssetViewer } from '../viewers';
import { BaseNodeComponent } from './BaseNodeComponent';

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

interface OperationNodeComponentProps {
  id: string;
  data: OperationNode;
  selected?: boolean;
}

export function OperationNodeComponent({ id, data, selected }: OperationNodeComponentProps) {
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

  // Get icon
  const IconComponent = OPERATION_ICONS[operationType] ?? CircleDot;

  // Toggle enabled
  const toggleEnabled = useCallback(() => {
    updateNode(id, { isEnabled: !isEnabled });
  }, [id, isEnabled, updateNode]);

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
    const contentBounds = calculateAccumulatedBounds(
      sourceAsset.intrinsicWidth,
      sourceAsset.intrinsicHeight,
      sourceLayer.baseTransform,
      upstreamTransformParams
    );

    // Get the viewer's screen bounds
    const viewerRect = e.currentTarget.getBoundingClientRect();

    // Find the node element to calculate viewer's offset from node position
    const nodeElement = e.currentTarget.closest('.react-flow__node');
    const nodeRect = nodeElement?.getBoundingClientRect();

    const viewerInfo = {
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

  // Enable toggle switch for header
  const headerToggle = (
    <Switch
      checked={isEnabled}
      onCheckedChange={toggleEnabled}
      className="scale-75"
    />
  );

  return (
    <BaseNodeComponent
      id={id}
      selected={selected}
      hasInputHandle={true}
      hasOutputHandle={true}
      icon={IconComponent}
      label={label || OPERATION_LABELS[operationType]}
      variant="default"
      isEnabled={isEnabled}
      headerExtra={headerToggle}
      onViewerClick={handleViewerClick}
      viewerClickable={operationType === 'transform' && hasUpstream}
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
    </BaseNodeComponent>
  );
}
