import type { Node as ReactFlowNode } from '@xyflow/react';
import type { OPFSFileMetadata } from '../utils/opfs';

/**
 * Base node data - this is just the DATA part of a node
 * It goes inside node.data, not the entire node
 */
export interface BaseNodeData {
  label: string;
  [key: string]: unknown;
}

/**
 * Extracted frames metadata (persisted)
 */
export interface ExtractedFramesInfo {
  frameCount: number;
  format: 'webp' | 'png' | 'jpeg';
  width: number;
  height: number;
  duration: number;
}

/**
 * File node data - extends base data
 * This is still just the DATA part
 */
export interface FileNodeData extends BaseNodeData {
  file: OPFSFileMetadata;
  extractedFrames?: ExtractedFramesInfo;
}

/**
 * Type alias for a file node using ReactFlow's Node type
 * This is the FULL node structure (id, position, data, etc.)
 */
export type FileNode = ReactFlowNode<FileNodeData>;

/**
 * Type alias for any node with base data
 */
export type CustomNode<T extends BaseNodeData = BaseNodeData> = ReactFlowNode<T>;

/**
 * Union type of all possible node types in the graph
 * Add new node types here as you create them
 * 
 * Example for future:
 * export type GraphNode = FileNode | EffectNode | TransformNode | OutputNode;
 */
export type GraphNode = FileNode;

// Helper type to extract node data type from a node
export type NodeData<T extends GraphNode> = T extends ReactFlowNode<infer D> ? D : never;