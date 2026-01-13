import type { VideoPrimitive } from '../../types/primitives'
import { createBasePrimitive } from './createPrimitive'

export function createVideoPrimitive(
  overrides: Partial<VideoPrimitive> = {}
): VideoPrimitive {
  const base = createBasePrimitive(overrides)
  return {
    ...base,
    type: 'video',
  }
}
