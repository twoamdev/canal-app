/**
 * Node Time Utilities
 *
 * Functions for working with node time ranges and frame mapping.
 */

import type { GraphNode, NodeTimeRange, VideoNodeData } from '../types/nodes';

interface GlobalTimeRange {
  start: number;
  end: number;
}

/**
 * Get the effective time range for a node (with defaults applied)
 *
 * - Video nodes: default to their native frame count
 * - Image nodes: default to global timeline range
 * - Effect nodes: should use getUpstreamTimeRange instead
 */
export function getNodeTimeRange(
  node: GraphNode,
  globalRange: GlobalTimeRange
): NodeTimeRange {
  // If node has explicit time range, use it
  const nodeData = node.data as { timeRange?: NodeTimeRange };
  if (nodeData.timeRange) {
    return nodeData.timeRange;
  }

  // Apply defaults based on node type
  switch (node.type) {
    case 'video': {
      const data = node.data as VideoNodeData;
      const frameCount = data.extractedFrames?.frameCount ?? 0;
      return {
        inFrame: 0,
        outFrame: frameCount,
        sourceOffset: 0,
      };
    }

    case 'image': {
      // Images are active for the entire global timeline by default
      return {
        inFrame: globalRange.start,
        outFrame: globalRange.end,
      };
    }

    case 'file': {
      // Generic files inherit global range
      return {
        inFrame: globalRange.start,
        outFrame: globalRange.end,
      };
    }

    // Effect nodes (blur, colorAdjust) inherit from their source
    // This function returns global range as fallback, but callers should
    // use getUpstreamTimeRange for effect nodes
    default:
      return {
        inFrame: globalRange.start,
        outFrame: globalRange.end,
      };
  }
}

/**
 * Check if a node is active (visible/outputting) at a given frame
 */
export function isNodeActiveAtFrame(
  node: GraphNode,
  frame: number,
  globalRange: GlobalTimeRange
): boolean {
  const range = getNodeTimeRange(node, globalRange);
  return frame >= range.inFrame && frame < range.outFrame;
}

/**
 * Map a global timeline frame to the corresponding source frame
 *
 * For video nodes: maps to the correct video frame based on time range
 * For image nodes: always returns 0 (single frame) when active
 *
 * Returns null if the global frame is outside the node's active range
 * (indicating the node should output black/transparent)
 */
export function getSourceFrameForGlobalFrame(
  node: GraphNode,
  globalFrame: number,
  globalRange: GlobalTimeRange
): number | null {
  const range = getNodeTimeRange(node, globalRange);

  // Check if global frame is within this node's active range
  if (globalFrame < range.inFrame || globalFrame >= range.outFrame) {
    return null; // Node is inactive at this frame
  }

  // For image nodes, always return 0 (single "frame")
  if (node.type === 'image') {
    return 0;
  }

  // For video nodes, calculate the source frame
  if (node.type === 'video') {
    const data = node.data as VideoNodeData;

    // Calculate which source frame to use
    const sourceOffset = range.sourceOffset ?? 0;
    const relativeFrame = globalFrame - range.inFrame;
    const sourceFrame = sourceOffset + relativeFrame;

    // Clamp to available frames
    const frameCount = data.extractedFrames?.frameCount ?? 0;
    if (sourceFrame < 0 || sourceFrame >= frameCount) {
      return null;
    }

    return sourceFrame;
  }

  // For other node types (shouldn't happen for source nodes)
  return null;
}

/**
 * Get the duration (in frames) of a node's active range
 */
export function getNodeDuration(
  node: GraphNode,
  globalRange: GlobalTimeRange
): number {
  const range = getNodeTimeRange(node, globalRange);
  return range.outFrame - range.inFrame;
}
