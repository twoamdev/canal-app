import type { BasePrimitive } from '../../types/primitives'

export function createBasePrimitive( overrides: Partial<BasePrimitive> = {}): BasePrimitive {
    return {
        id: "0",
        type: "none",
        zIndex: 0,
        transform: {
            pivot: { x: 0, y: 0 },
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
        },
        bounds: {
            xMin: 0,
            yMin: 0,
            xMax: 0,
            yMax: 0
        },
        opacity: 100,
        visible: true,
        frameRange: { start: 0, end: 100 },
        frameRate: 30,
        //effects: Effect[];
        ...overrides,
    }
}
