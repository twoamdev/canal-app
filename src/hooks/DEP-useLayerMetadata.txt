/**
 * useLayerMetadata Hook
 *
 * React hook for accessing layer metadata for a node.
 * Provides time range, effect chain, and layer stack information.
 */

import { useMemo } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useTimelineStore } from '../stores/timelineStore';
import {
  getLayerOutput,
  getEffectiveTimeRange,
  getLayerEffectChain,
  getLayersAtNode,
  getOutputDimensions,
} from '../utils/layer-metadata';
import type {
  LayerOutput,
  StackedLayer,
  AppliedEffect,
} from '../types/layer-metadata';
import type { NodeTimeRange } from '../types/nodes';

interface UseLayerMetadataResult {
  /** Full layer output (single or stack) */
  output: LayerOutput | null;

  /** Effective time range (propagated from source, union for merges) */
  timeRange: NodeTimeRange | null;

  /** All layers (for merge nodes, includes full stack) */
  layers: StackedLayer[] | null;

  /** Effect chain for primary layer */
  effectChain: AppliedEffect[] | null;

  /** Output dimensions */
  dimensions: { width: number; height: number } | null;

  /** Whether this node has valid layer metadata */
  isValid: boolean;

  /** Whether this is a layer stack (from merge) */
  isStack: boolean;

  /** Number of layers (1 for single, N for stack) */
  layerCount: number;
}

/**
 * Hook to access layer metadata for a node
 *
 * @param nodeId The node ID to get layer metadata for
 * @returns Layer metadata including time range, effect chain, and layer stack
 */
export function useLayerMetadata(nodeId: string): UseLayerMetadataResult {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);

  const globalRange = useMemo(
    () => ({ start: frameStart, end: frameEnd }),
    [frameStart, frameEnd]
  );

  const output = useMemo(
    () => getLayerOutput(nodeId, nodes, edges, globalRange),
    [nodeId, nodes, edges, globalRange]
  );

  const timeRange = useMemo(
    () => getEffectiveTimeRange(nodeId, nodes, edges, globalRange),
    [nodeId, nodes, edges, globalRange]
  );

  const layers = useMemo(
    () => getLayersAtNode(nodeId, nodes, edges, globalRange),
    [nodeId, nodes, edges, globalRange]
  );

  const effectChain = useMemo(
    () => getLayerEffectChain(nodeId, nodes, edges, globalRange),
    [nodeId, nodes, edges, globalRange]
  );

  const dimensions = useMemo(
    () => getOutputDimensions(nodeId, nodes, edges, globalRange),
    [nodeId, nodes, edges, globalRange]
  );

  return {
    output,
    timeRange,
    layers,
    effectChain,
    dimensions,
    isValid: output !== null,
    isStack: output?.type === 'stack',
    layerCount: layers?.length ?? 0,
  };
}

/**
 * Hook to get just the effective time range for a node
 * Lighter weight than full useLayerMetadata
 */
export function useEffectiveTimeRange(nodeId: string): NodeTimeRange | null {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);

  return useMemo(
    () =>
      getEffectiveTimeRange(nodeId, nodes, edges, {
        start: frameStart,
        end: frameEnd,
      }),
    [nodeId, nodes, edges, frameStart, frameEnd]
  );
}

/**
 * Hook to get the layer stack for a node (useful for merge nodes)
 */
export function useLayerStack(nodeId: string): StackedLayer[] | null {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);

  return useMemo(
    () =>
      getLayersAtNode(nodeId, nodes, edges, {
        start: frameStart,
        end: frameEnd,
      }),
    [nodeId, nodes, edges, frameStart, frameEnd]
  );
}
