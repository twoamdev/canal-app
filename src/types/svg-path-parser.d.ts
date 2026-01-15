declare module 'svg-path-parser' {
  export interface MoveToCommand {
    code: 'M' | 'm';
    command: 'moveto';
    x: number;
    y: number;
  }

  export interface LineToCommand {
    code: 'L' | 'l';
    command: 'lineto';
    x: number;
    y: number;
  }

  export interface HorizontalLineToCommand {
    code: 'H' | 'h';
    command: 'horizontal lineto';
    x: number;
  }

  export interface VerticalLineToCommand {
    code: 'V' | 'v';
    command: 'vertical lineto';
    y: number;
  }

  export interface CurveToCommand {
    code: 'C' | 'c';
    command: 'curveto';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    x: number;
    y: number;
  }

  export interface SmoothCurveToCommand {
    code: 'S' | 's';
    command: 'smooth curveto';
    x2: number;
    y2: number;
    x: number;
    y: number;
  }

  export interface QuadraticCurveToCommand {
    code: 'Q' | 'q';
    command: 'quadratic curveto';
    x1: number;
    y1: number;
    x: number;
    y: number;
  }

  export interface SmoothQuadraticCurveToCommand {
    code: 'T' | 't';
    command: 'smooth quadratic curveto';
    x: number;
    y: number;
  }

  export interface ArcCommand {
    code: 'A' | 'a';
    command: 'elliptical arc';
    rx: number;
    ry: number;
    xAxisRotation: number;
    largeArc: boolean;
    sweep: boolean;
    x: number;
    y: number;
  }

  export interface ClosePathCommand {
    code: 'Z' | 'z';
    command: 'closepath';
  }

  export type Command =
    | MoveToCommand
    | LineToCommand
    | HorizontalLineToCommand
    | VerticalLineToCommand
    | CurveToCommand
    | SmoothCurveToCommand
    | QuadraticCurveToCommand
    | SmoothQuadraticCurveToCommand
    | ArcCommand
    | ClosePathCommand;

  export function parseSVG(path: string): Command[];
  export function makeAbsolute(commands: Command[]): Command[];
}
