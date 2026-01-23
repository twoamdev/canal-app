/**
 * Transform Utilities
 *
 * Utilities for calculating transformed bounds and accumulating transforms
 * through a chain of transform operations.
 */

import type { Transform, TransformParams } from '../types/scene-graph';

/**
 * Axis-aligned bounding box representing transformed content
 */
export interface BoundingBox {
  /** Top-left X position (can be negative) */
  x: number;
  /** Top-left Y position (can be negative) */
  y: number;
  /** Width of the bounding box */
  width: number;
  /** Height of the bounding box */
  height: number;
  /** Center X of the bounding box */
  centerX: number;
  /** Center Y of the bounding box */
  centerY: number;
}

/**
 * A 2D point
 */
interface Point {
  x: number;
  y: number;
}

/**
 * Transform a point around an anchor with scale, rotation, and translation
 */
function transformPoint(
  point: Point,
  anchor: Point,
  scale: { x: number; y: number },
  rotationDeg: number,
  translation: Point
): Point {
  // Convert rotation to radians
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // 1. Translate point relative to anchor
  const relX = point.x - anchor.x;
  const relY = point.y - anchor.y;

  // 2. Apply scale
  const scaledX = relX * scale.x;
  const scaledY = relY * scale.y;

  // 3. Apply rotation
  const rotatedX = scaledX * cos - scaledY * sin;
  const rotatedY = scaledX * sin + scaledY * cos;

  // 4. Translate back from anchor and add position offset
  return {
    x: rotatedX + anchor.x + translation.x,
    y: rotatedY + anchor.y + translation.y,
  };
}

/**
 * Calculate the axis-aligned bounding box of a rectangle after applying a transform.
 *
 * The algorithm:
 * 1. Define the 4 corners of the original rectangle
 * 2. Transform each corner (scale around anchor, rotate, translate)
 * 3. Find min/max X and Y of transformed corners to get AABB
 *
 * @param width - Original width of the rectangle
 * @param height - Original height of the rectangle
 * @param transform - Transform to apply (position, scale, rotation, anchorPoint)
 * @returns Axis-aligned bounding box of the transformed rectangle
 */
export function calculateTransformedBounds(
  width: number,
  height: number,
  transform: TransformParams
): BoundingBox {
  const { position, scale, rotation, anchorPoint } = transform;

  // Calculate anchor point in pixels
  const anchor: Point = {
    x: anchorPoint.x * width,
    y: anchorPoint.y * height,
  };

  // Define the 4 corners of the original rectangle
  const corners: Point[] = [
    { x: 0, y: 0 },           // top-left
    { x: width, y: 0 },       // top-right
    { x: width, y: height },  // bottom-right
    { x: 0, y: height },      // bottom-left
  ];

  // Transform each corner
  const transformedCorners = corners.map(corner =>
    transformPoint(corner, anchor, scale, rotation, position)
  );

  // Find AABB by getting min/max of all corners
  const xs = transformedCorners.map(c => c.x);
  const ys = transformedCorners.map(c => c.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;

  return {
    x: minX,
    y: minY,
    width: boxWidth,
    height: boxHeight,
    centerX: minX + boxWidth / 2,
    centerY: minY + boxHeight / 2,
  };
}

/**
 * Calculate the accumulated bounding box through a chain of transforms.
 *
 * Each transform in the chain acts on the RESULT of previous transforms.
 * This means the bounds can grow (e.g., rotation makes diagonal larger)
 * and the subsequent transform's anchor point is relative to the new bounds.
 *
 * @param originalWidth - Original asset/layer width
 * @param originalHeight - Original asset/layer height
 * @param baseTransform - The layer's base transform (applied first)
 * @param chainTransforms - Array of transform params from operation nodes (in order)
 * @returns Final accumulated bounding box
 */
export function calculateAccumulatedBounds(
  originalWidth: number,
  originalHeight: number,
  baseTransform: Transform,
  chainTransforms: TransformParams[]
): BoundingBox {
  // Start with the base transform from the layer
  let currentBounds = calculateTransformedBounds(originalWidth, originalHeight, {
    position: baseTransform.position,
    scale: baseTransform.scale,
    rotation: baseTransform.rotation,
    anchorPoint: baseTransform.anchorPoint,
  });

  // Apply each transform in the chain
  // Each transform acts on the AABB of the previous result
  for (const transform of chainTransforms) {
    // The new transform acts on the current bounds
    // We need to calculate where the content would be after this transform
    const newBounds = calculateTransformedBounds(
      currentBounds.width,
      currentBounds.height,
      transform
    );

    // The new bounds are relative to the previous bounds' origin
    // So we need to offset by the previous bounds position
    currentBounds = {
      x: currentBounds.x + newBounds.x,
      y: currentBounds.y + newBounds.y,
      width: newBounds.width,
      height: newBounds.height,
      centerX: currentBounds.x + newBounds.centerX,
      centerY: currentBounds.y + newBounds.centerY,
    };
  }

  return currentBounds;
}

/**
 * Convert a Transform to TransformParams (drops opacity)
 */
export function transformToParams(transform: Transform): TransformParams {
  return {
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
    anchorPoint: transform.anchorPoint,
  };
}

/**
 * Create an identity transform params (no transformation)
 */
export function identityTransformParams(): TransformParams {
  return {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchorPoint: { x: 0.5, y: 0.5 },
  };
}

/**
 * Check if a transform is effectively an identity transform (no visible change)
 */
export function isIdentityTransform(transform: TransformParams): boolean {
  return (
    transform.position.x === 0 &&
    transform.position.y === 0 &&
    transform.scale.x === 1 &&
    transform.scale.y === 1 &&
    transform.rotation === 0
  );
}
