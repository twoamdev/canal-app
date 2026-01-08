/**
 * Effects Index
 *
 * Exports all effect classes and ensures they are registered.
 */

// Import effects to trigger registration
import './ColorAdjustEffect';
import './GaussianBlurEffect';

// Re-export for direct usage
export { Effect, DEFAULT_VERTEX_SHADER, SHADER_COMMON } from './Effect';
export { effectRegistry } from './registry';
export { ColorAdjustEffect } from './ColorAdjustEffect';
export { GaussianBlurEffect } from './GaussianBlurEffect';
