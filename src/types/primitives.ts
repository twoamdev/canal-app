import type { SvgPath } from "./svg";

export interface BasePrimitive {
    id: string;
    zIndex: number;
    type: string;

    transform: {
        pivot: { x: number, y: number },
        position: { x: number, y: number },
        scale: { x: number, y: number },
        rotation: number,
    };
    
    bounds: { xMin: number, yMin: number, xMax: number, yMax: number };
    opacity: number;
    visible: boolean;
    frameRange: { start: number, end: number };
    frameRate: number;
    //effects: Effect[];
}


export interface VideoPrimitive extends BasePrimitive {
    type: 'video';
}

export interface ImagePrimitive extends BasePrimitive {
    type: 'image';
}

export interface ShapePrimitive extends BasePrimitive {
    type: 'shape';
    paths: SvgPath[];
}

export interface FilterPrimitive extends BasePrimitive {
    type: 'filter';
    appliesTo: string[]; // primitive ids
}

export type Primitive = ImagePrimitive | VideoPrimitive  | ShapePrimitive | FilterPrimitive;