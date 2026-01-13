/**
 * Layer Metadata Types
 *
 * Defines the structure for layer metadata that propagates through the node graph.
 * Source nodes create layers, effects accumulate on layers, merges create layer stacks.
 */

import type { NodeTimeRange, NodeFormat, EffectConfig, MergeBlendMode } from './nodes';

/**
 * Transform properties for positioning a layer
 * (Phase 2 - initially all defaults)
 */
export interface LayerTransform {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  anchor: { x: number; y: number };
}

/**
 * Default transform (no modification)
 */
export const DEFAULT_TRANSFORM: LayerTransform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
};

/**
 * An effect that has been applied to a layer
 * Contains both the config and the node that applied it
 */
export interface AppliedEffect {
  /** The node ID that applied this effect */
  nodeId: string;

  /** The effect configuration */
  config: EffectConfig;
}

/**
 * A single layer's complete metadata
 * Represents one visual element's journey through the graph
 */
export interface LayerMetadata {
  /** Unique identifier for this layer (matches source node ID) */
  sourceId: string;

  /** Type of source that created this layer */
  sourceType: 'video' | 'image';

  /** Time range when this layer is active (propagated from source) */
  timeRange: NodeTimeRange;

  /** Native dimensions of the source */
  sourceDimensions: NodeFormat;

  /** Current output dimensions (may differ after transforms) */
  outputDimensions: NodeFormat;

  /** Transform properties (Phase 2) */
  transform: LayerTransform;

  /**
   * Chain of effects applied to this layer
   * Ordered from first applied to last
   */
  effectChain: AppliedEffect[];

  /** Path through the graph (node IDs from source to current) */
  nodePath: string[];
}

/**
 * Blend configuration for a layer in a stack
 */
export interface LayerBlendConfig {
  /** Blend mode for compositing */
  blendMode: MergeBlendMode;

  /** Opacity (0-1) */
  opacity: number;

  /** Stack index (0 = bottom, higher = on top) */
  stackIndex: number;
}

/**
 * A layer within a stack (includes blend info)
 */
export interface StackedLayer {
  /** The layer's metadata */
  layer: LayerMetadata;

  /** How this layer blends with layers below */
  blend: LayerBlendConfig;
}

/**
 * A stack of layers (output of a merge node)
 */
export interface LayerStack {
  /** Ordered array of layers (index 0 = bottom) */
  layers: StackedLayer[];

  /** Combined time range (union of all layer ranges) */
  timeRange: NodeTimeRange;

  /** Output dimensions (from bottom/bg layer) */
  outputDimensions: NodeFormat;

  /** The merge node that created this stack */
  mergeNodeId: string;
}

/**
 * Union type: a node's output can be a single layer or a stack
 */
export type LayerOutput =
  | { type: 'single'; layer: LayerMetadata }
  | { type: 'stack'; stack: LayerStack };

/**
 * Cached computation result for a node's layer output
 */
export interface LayerCacheEntry {
  /** The computed layer output */
  output: LayerOutput;

  /** Hash of inputs used to compute this (for invalidation) */
  inputHash: string;

  /** Timestamp of computation */
  computedAt: number;
}

/**
 * Create initial layer metadata from a source node
 */
export function createLayerFromSource(
  sourceId: string,
  sourceType: 'video' | 'image',
  timeRange: NodeTimeRange,
  dimensions: NodeFormat
): LayerMetadata {
  return {
    sourceId,
    sourceType,
    timeRange,
    sourceDimensions: dimensions,
    outputDimensions: dimensions,
    transform: { ...DEFAULT_TRANSFORM },
    effectChain: [],
    nodePath: [sourceId],
  };
}
