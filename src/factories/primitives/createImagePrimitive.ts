import type { ImagePrimitive } from '../../types/primitives'
import { createBasePrimitive } from './createPrimitive'

export function createImagePrimitive(
  overrides: Partial<ImagePrimitive> = {}
): ImagePrimitive {
  const base = createBasePrimitive(overrides)
  return {
    ...base,
    type: 'image',
  }
}
