/**
 * Scene Graph Type Definitions
 *
 * Defines the node types and connections that make up a composition's graph.
 * - SourceNode: References an asset via a Layer
 * - OperationNode: Applies effects/transforms to the signal
 */

// =============================================================================
// Transform
// =============================================================================

export interface Position2D {
  x: number;
  y: number;
}

export interface Scale2D {
  x: number;
  y: number;
}

/**
 * Transform applied to a layer
 */
export interface Transform {
  position: Position2D;
  scale: Scale2D;
  /** Rotation in degrees */
  rotation: number;
  /** Opacity 0-1 */
  opacity: number;
  /** Anchor point (0-1 relative to dimensions, 0.5,0.5 = center) */
  anchorPoint: Position2D;
}

/**
 * Default transform (identity)
 */
export const DEFAULT_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  anchorPoint: { x: 0.5, y: 0.5 },
};

// =============================================================================
// Time Range
// =============================================================================

/**
 * Defines when a node/layer is active on the timeline
 */
export interface TimeRange {
  /** First frame this is active (inclusive) */
  inFrame: number;
  /** Last frame this is active (exclusive) */
  outFrame: number;
  /** For videos: which source frame maps to inFrame */
  sourceOffset: number;
}

/**
 * Create a default time range
 */
export function createDefaultTimeRange(frameCount: number): TimeRange {
  return {
    inFrame: 0,
    outFrame: frameCount,
    sourceOffset: 0,
  };
}

// =============================================================================
// Layer
// =============================================================================

let layerIdCounter = 0;

/**
 * Generate a unique layer ID
 */
export function generateLayerId(): string {
  return `layer_${Date.now()}_${++layerIdCounter}`;
}

/**
 * Layer references an asset and defines how it appears
 */
export interface Layer {
  /** Unique identifier for this layer */
  id: string;
  /** Reference to the Asset in the AssetLibrary */
  assetId: string;
  /** Transform applied to this layer */
  baseTransform: Transform;
  /** IDs of connected OperationNodes (for tracking which effects apply) */
  effects: string[];
  /** Time range when this layer is active */
  timeRange: TimeRange;
  /** Display name for the layer */
  name: string;
}

/**
 * Create a new layer referencing an asset
 */
export function createLayer(
  assetId: string,
  name: string,
  frameCount: number
): Layer {
  return {
    id: generateLayerId(),
    assetId,
    name,
    baseTransform: { ...DEFAULT_TRANSFORM },
    effects: [],
    timeRange: createDefaultTimeRange(frameCount),
  };
}

// =============================================================================
// Group
// =============================================================================

let groupIdCounter = 0;

/**
 * Generate a unique group ID
 */
export function generateGroupId(): string {
  return `group_${Date.now()}_${++groupIdCounter}`;
}

/**
 * Group combines multiple layers/groups with z-order control.
 * Similar to Layer but holds memberIds instead of assetId.
 */
export interface Group {
  /** Unique identifier for this group */
  id: string;
  /** Ordered list of member IDs (Layer IDs or Group IDs).
   * Index 0 = background (renders first), last index = foreground (renders last) */
  memberIds: string[];
  /** Transform applied to the combined result */
  baseTransform: Transform;
  /** IDs of connected OperationNodes (for tracking which effects apply) */
  effects: string[];
  /** Time range when this group is active */
  timeRange: TimeRange;
  /** Display name for the group */
  name: string;
}

/**
 * Create a new group
 */
export function createGroup(
  name: string,
  memberIds: string[] = [],
  durationFrames: number = 1
): Group {
  return {
    id: generateGroupId(),
    memberIds,
    name,
    baseTransform: { ...DEFAULT_TRANSFORM },
    effects: [],
    timeRange: createDefaultTimeRange(durationFrames),
  };
}

// =============================================================================
// Operation Types
// =============================================================================

export type OperationType = 'blur' | 'color_correct' | 'transform';

/**
 * Parameter types for different operations
 */
export interface BlurParams {
  radius: number;
}

export interface ColorCorrectParams {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
}

export interface TransformParams {
  position: Position2D;
  scale: Scale2D;
  rotation: number;
  anchorPoint: Position2D;
}

export type OperationParams = BlurParams | ColorCorrectParams | TransformParams;

/**
 * Default parameters for each operation type
 */
export const DEFAULT_OPERATION_PARAMS: Record<OperationType, OperationParams> = {
  blur: { radius: 10 } as BlurParams,
  color_correct: {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    exposure: 0,
  } as ColorCorrectParams,
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchorPoint: { x: 0.5, y: 0.5 },
  } as TransformParams,
};

// =============================================================================
// Scene Nodes
// =============================================================================

/**
 * Base properties shared by all scene nodes
 * Index signature added for ReactFlow compatibility
 */
interface BaseSceneNode {
  id: string;
  /** Position in the ReactFlow canvas */
  position: Position2D;
  /** Whether the node is selected */
  selected?: boolean;
  /** Index signature for ReactFlow compatibility */
  [key: string]: unknown;
}

/**
 * Source node - references a layer by ID
 */
export interface SourceNode extends BaseSceneNode {
  type: 'source';
  /** Reference to the Layer in LayerStore */
  layerId: string;
}

export interface EmptyNode extends BaseSceneNode {
  type: 'empty';
}

/**
 * Operation node - applies an effect/transform to the upstream signal
 */
export interface OperationNode extends BaseSceneNode {
  type: 'operation';
  /** The type of operation */
  operationType: OperationType;
  /** Parameters for the operation (type varies by operationType) */
  params: OperationParams;
  /** Whether this operation is enabled */
  isEnabled: boolean;
  /** Display label */
  label: string;
}

/**
 * Group node - combines multiple sources/groups with z-order control
 */
export interface GroupNode extends BaseSceneNode {
  type: 'group';
  /** Reference to the Group in GroupStore */
  groupId: string;
  /** Display label */
  label: string;
}

/**
 * Union type for all scene nodes
 */
export type SceneNode = SourceNode | EmptyNode | OperationNode | GroupNode;

// =============================================================================
// Type Guards
// =============================================================================

export function isSourceNode(node: SceneNode): node is SourceNode {
  return node.type === 'source';
}

export function isOperationNode(node: SceneNode): node is OperationNode {
  return node.type === 'operation';
}

export function isGroupNode(node: SceneNode): node is GroupNode {
  return node.type === 'group';
}

// =============================================================================
// Connection
// =============================================================================

/**
 * Connection between two nodes in the graph
 */
export interface Connection {
  id: string;
  /** ID of the source node */
  source: string;
  /** ID of the target node */
  target: string;
  /** Handle ID on the source node (optional) */
  sourceHandle?: string;
  /** Handle ID on the target node (optional) */
  targetHandle?: string;
}

// =============================================================================
// Factory Functions
// =============================================================================

let nodeIdCounter = 0;

/**
 * Generate a unique node ID
 */
export function generateNodeId(): string {
  return `node_${Date.now()}_${++nodeIdCounter}`;
}

/**
 * Generate a unique connection ID
 */
export function generateConnectionId(): string {
  return `conn_${Date.now()}_${++nodeIdCounter}`;
}

/**
 * Create a new SourceNode
 * Note: Caller must create the Layer first and pass its ID
 */
export function createSourceNode(
  layerId: string,
  position: Position2D = { x: 0, y: 0 }
): SourceNode {
  return {
    id: generateNodeId(),
    type: 'source',
    position,
    layerId,
  };
}

export function createEmptyNode(
  position: Position2D = { x: 0, y: 0 }
): EmptyNode {
  return {
    id: generateNodeId(),
    type: 'empty',
    position,
  };
}

/**
 * Create a new OperationNode
 */
export function createOperationNode(
  operationType: OperationType,
  position: Position2D = { x: 0, y: 0 }
): OperationNode {
  const labels: Record<OperationType, string> = {
    blur: 'Blur',
    color_correct: 'Color Correct',
    transform: 'Transform',
  };

  return {
    id: generateNodeId(),
    type: 'operation',
    position,
    operationType,
    params: { ...DEFAULT_OPERATION_PARAMS[operationType] },
    isEnabled: true,
    label: labels[operationType],
  };
}

/**
 * Create a new GroupNode
 */
export function createGroupNode(
  groupId: string,
  name: string = 'Group',
  position: Position2D = { x: 0, y: 0 }
): GroupNode {
  return {
    id: generateNodeId(),
    type: 'group',
    position,
    groupId,
    label: name,
  };
}

/**
 * Create a new Connection
 */
export function createConnection(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string
): Connection {
  return {
    id: generateConnectionId(),
    source,
    target,
    sourceHandle,
    targetHandle,
  };
}

// =============================================================================
// Graph Utilities
// =============================================================================

/**
 * Convert scene nodes to ReactFlow format
 */
export function sceneNodesToReactFlow(nodes: Record<string, SceneNode>): Array<{
  id: string;
  type: string;
  position: Position2D;
  data: SceneNode;
  selected?: boolean;
}> {
  return Object.values(nodes).map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: node,
    selected: node.selected,
  }));
}

/**
 * Convert connections to ReactFlow edge format
 */
export function connectionsToReactFlowEdges(connections: Connection[]): Array<{
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}> {
  return connections.map((conn) => ({
    id: conn.id,
    source: conn.source,
    target: conn.target,
    sourceHandle: conn.sourceHandle,
    targetHandle: conn.targetHandle,
  }));
}
