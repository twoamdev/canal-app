/**
 * SVG Parser Utility
 *
 * Parses SVG files/strings and extracts path data, fill, stroke properties.
 * Calculates bounding box from path commands.
 */

import { parseSVG, makeAbsolute, type Command } from 'svg-path-parser';

// =============================================================================
// Types
// =============================================================================

export interface SVGPathStyle {
  /** Fill color (CSS color string or 'none') */
  fill?: string;
  /** Fill opacity (0-1) */
  fillOpacity?: number;
  /** Fill rule */
  fillRule?: 'evenodd' | 'nonzero';
  /** Stroke color (CSS color string or 'none') */
  stroke?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Stroke opacity (0-1) */
  strokeOpacity?: number;
  /** Stroke line cap */
  strokeLinecap?: 'butt' | 'round' | 'square';
  /** Stroke line join */
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  /** Stroke miter limit */
  strokeMiterlimit?: number;
  /** Stroke dash array */
  strokeDasharray?: number[];
  /** Stroke dash offset */
  strokeDashoffset?: number;
}

export interface ParsedSVGPath {
  /** Original path d attribute */
  pathData: string;
  /** Parsed and normalized (absolute) commands */
  commands: Command[];
  /** Style properties */
  style: SVGPathStyle;
  /** Bounding box */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ParsedSVG {
  /** All paths in the SVG */
  paths: ParsedSVGPath[];
  /** Combined bounding box of all paths */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Original viewBox if present */
  viewBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Original width/height attributes if present */
  dimensions?: {
    width: number;
    height: number;
  };
}

// =============================================================================
// Color Parsing
// =============================================================================

/**
 * Parse a color value from SVG attribute
 * Handles solid colors, 'none', and url() references
 */
function parseColor(value: string | null | undefined): string | undefined {
  if (!value || value === 'none' || value === 'transparent') {
    return value === 'none' ? 'none' : undefined;
  }

  // Handle url() references (gradients, patterns, masks)
  // For now, we'll return a fallback color but preserve the info that it was a reference
  // This allows shapes to at least render with some fill
  if (value.startsWith('url(')) {
    // Return a distinguishable placeholder - the actual gradient/pattern won't render
    // but at least the shape will be visible
    return '#808080'; // Gray fallback for url() references
  }

  // Return the color value (CSS color string)
  return value.trim();
}

/**
 * Set of SVG elements that are definition containers (not visual content)
 * These should be skipped when extracting renderable paths
 */
const NON_VISUAL_ELEMENTS = new Set([
  'defs',
  'mask',
  'clippath',
  'filter',
  'symbol',
  'lineargradient',
  'radialgradient',
  'pattern',
  'marker',
  'style',
  'script',
  'title',
  'desc',
  'metadata',
]);

/**
 * Check if an element is a non-visual definition element
 */
function isNonVisualElement(tagName: string): boolean {
  return NON_VISUAL_ELEMENTS.has(tagName.toLowerCase());
}

/**
 * Parse a numeric value with optional unit
 */
function parseNumeric(value: string | null | undefined): number | undefined {
  if (!value) return undefined;

  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

/**
 * Parse stroke dash array
 */
function parseDashArray(value: string | null | undefined): number[] | undefined {
  if (!value || value === 'none') return undefined;

  const parts = value.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
  return parts.length > 0 ? parts : undefined;
}

// =============================================================================
// Bounding Box Calculation
// =============================================================================

/**
 * Calculate bounding box from path commands
 * Uses absolute coordinates from makeAbsolute()
 */
function calculatePathBounds(commands: Command[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let currentX = 0;
  let currentY = 0;

  for (const cmd of commands) {
    switch (cmd.code) {
      case 'M':
      case 'L':
      case 'T':
        currentX = cmd.x;
        currentY = cmd.y;
        minX = Math.min(minX, currentX);
        minY = Math.min(minY, currentY);
        maxX = Math.max(maxX, currentX);
        maxY = Math.max(maxY, currentY);
        break;

      case 'H':
        currentX = cmd.x;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        break;

      case 'V':
        currentY = cmd.y;
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        break;

      case 'C':
        // Cubic bezier: include control points and end point
        minX = Math.min(minX, cmd.x1, cmd.x2, cmd.x);
        minY = Math.min(minY, cmd.y1, cmd.y2, cmd.y);
        maxX = Math.max(maxX, cmd.x1, cmd.x2, cmd.x);
        maxY = Math.max(maxY, cmd.y1, cmd.y2, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;

      case 'S':
        // Smooth cubic bezier
        minX = Math.min(minX, cmd.x2, cmd.x);
        minY = Math.min(minY, cmd.y2, cmd.y);
        maxX = Math.max(maxX, cmd.x2, cmd.x);
        maxY = Math.max(maxY, cmd.y2, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;

      case 'Q':
        // Quadratic bezier
        minX = Math.min(minX, cmd.x1, cmd.x);
        minY = Math.min(minY, cmd.y1, cmd.y);
        maxX = Math.max(maxX, cmd.x1, cmd.x);
        maxY = Math.max(maxY, cmd.y1, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;

      case 'A':
        // Arc: simplified bounds using end point
        // For accurate bounds, we'd need to calculate the actual arc
        minX = Math.min(minX, cmd.x);
        minY = Math.min(minY, cmd.y);
        maxX = Math.max(maxX, cmd.x);
        maxY = Math.max(maxY, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;

      case 'Z':
        // Close path - no bounds change
        break;
    }
  }

  // Handle empty or invalid paths
  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Combine multiple bounding boxes
 */
function combineBounds(
  boundsList: Array<{ x: number; y: number; width: number; height: number }>
): { x: number; y: number; width: number; height: number } {
  if (boundsList.length === 0) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const b of boundsList) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// =============================================================================
// Style Extraction
// =============================================================================

/**
 * Extract style from an SVG element
 */
function extractStyle(element: Element): SVGPathStyle {
  const style: SVGPathStyle = {};

  // Get attributes directly
  const fill = element.getAttribute('fill');
  const fillOpacity = element.getAttribute('fill-opacity');
  const fillRule = element.getAttribute('fill-rule');
  const stroke = element.getAttribute('stroke');
  const strokeWidth = element.getAttribute('stroke-width');
  const strokeOpacity = element.getAttribute('stroke-opacity');
  const strokeLinecap = element.getAttribute('stroke-linecap');
  const strokeLinejoin = element.getAttribute('stroke-linejoin');
  const strokeMiterlimit = element.getAttribute('stroke-miterlimit');
  const strokeDasharray = element.getAttribute('stroke-dasharray');
  const strokeDashoffset = element.getAttribute('stroke-dashoffset');

  // Also check inline style attribute
  const inlineStyle = element.getAttribute('style');
  const styleProps: Record<string, string> = {};

  if (inlineStyle) {
    inlineStyle.split(';').forEach((prop) => {
      const [key, value] = prop.split(':').map((s) => s.trim());
      if (key && value) {
        styleProps[key] = value;
      }
    });
  }

  // Parse values (inline style takes precedence)
  const parsedFill = parseColor(styleProps['fill'] ?? fill);
  if (parsedFill !== undefined) style.fill = parsedFill;

  const parsedFillOpacity = parseNumeric(styleProps['fill-opacity'] ?? fillOpacity);
  if (parsedFillOpacity !== undefined) style.fillOpacity = parsedFillOpacity;

  const parsedFillRule = styleProps['fill-rule'] ?? fillRule;
  if (parsedFillRule === 'evenodd' || parsedFillRule === 'nonzero') {
    style.fillRule = parsedFillRule;
  }

  const parsedStroke = parseColor(styleProps['stroke'] ?? stroke);
  if (parsedStroke !== undefined) style.stroke = parsedStroke;

  const parsedStrokeWidth = parseNumeric(styleProps['stroke-width'] ?? strokeWidth);
  if (parsedStrokeWidth !== undefined) style.strokeWidth = parsedStrokeWidth;

  const parsedStrokeOpacity = parseNumeric(styleProps['stroke-opacity'] ?? strokeOpacity);
  if (parsedStrokeOpacity !== undefined) style.strokeOpacity = parsedStrokeOpacity;

  const parsedLinecap = styleProps['stroke-linecap'] ?? strokeLinecap;
  if (parsedLinecap === 'butt' || parsedLinecap === 'round' || parsedLinecap === 'square') {
    style.strokeLinecap = parsedLinecap;
  }

  const parsedLinejoin = styleProps['stroke-linejoin'] ?? strokeLinejoin;
  if (parsedLinejoin === 'miter' || parsedLinejoin === 'round' || parsedLinejoin === 'bevel') {
    style.strokeLinejoin = parsedLinejoin;
  }

  const parsedMiterlimit = parseNumeric(styleProps['stroke-miterlimit'] ?? strokeMiterlimit);
  if (parsedMiterlimit !== undefined) style.strokeMiterlimit = parsedMiterlimit;

  const parsedDasharray = parseDashArray(styleProps['stroke-dasharray'] ?? strokeDasharray);
  if (parsedDasharray !== undefined) style.strokeDasharray = parsedDasharray;

  const parsedDashoffset = parseNumeric(styleProps['stroke-dashoffset'] ?? strokeDashoffset);
  if (parsedDashoffset !== undefined) style.strokeDashoffset = parsedDashoffset;

  return style;
}

/**
 * Inherit style from parent elements
 */
function inheritStyle(child: SVGPathStyle, parent: SVGPathStyle): SVGPathStyle {
  return {
    fill: child.fill ?? parent.fill,
    fillOpacity: child.fillOpacity ?? parent.fillOpacity,
    fillRule: child.fillRule ?? parent.fillRule,
    stroke: child.stroke ?? parent.stroke,
    strokeWidth: child.strokeWidth ?? parent.strokeWidth,
    strokeOpacity: child.strokeOpacity ?? parent.strokeOpacity,
    strokeLinecap: child.strokeLinecap ?? parent.strokeLinecap,
    strokeLinejoin: child.strokeLinejoin ?? parent.strokeLinejoin,
    strokeMiterlimit: child.strokeMiterlimit ?? parent.strokeMiterlimit,
    strokeDasharray: child.strokeDasharray ?? parent.strokeDasharray,
    strokeDashoffset: child.strokeDashoffset ?? parent.strokeDashoffset,
  };
}

// =============================================================================
// SVG Parsing
// =============================================================================

/**
 * Get the href from a <use> element (handles both href and xlink:href)
 */
function getUseHref(element: Element): string | null {
  // Try standard href first
  let href = element.getAttribute('href');
  if (!href) {
    // Fall back to xlink:href for older SVGs
    href = element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  }
  return href;
}

/**
 * Parse an SVG string into structured data
 */
export function parseSVGString(svgString: string): ParsedSVG {
  // Parse SVG as DOM
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid SVG: ${parseError.textContent}`);
  }

  const svgElement = doc.querySelector('svg');
  if (!svgElement) {
    throw new Error('No SVG element found');
  }

  // Extract viewBox
  let viewBox: ParsedSVG['viewBox'];
  const viewBoxAttr = svgElement.getAttribute('viewBox');
  if (viewBoxAttr) {
    const parts = viewBoxAttr.split(/[\s,]+/).map(parseFloat);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      viewBox = {
        x: parts[0],
        y: parts[1],
        width: parts[2],
        height: parts[3],
      };
    }
  }

  // Extract dimensions
  let dimensions: ParsedSVG['dimensions'];
  const widthAttr = svgElement.getAttribute('width');
  const heightAttr = svgElement.getAttribute('height');
  if (widthAttr && heightAttr) {
    const width = parseFloat(widthAttr);
    const height = parseFloat(heightAttr);
    if (!isNaN(width) && !isNaN(height)) {
      dimensions = { width, height };
    }
  }

  // Get root style
  const rootStyle = extractStyle(svgElement);

  // Find all path elements and extract their data
  const paths: ParsedSVGPath[] = [];

  // Track processed <use> references to avoid infinite loops
  const processedUseRefs = new Set<string>();

  // Helper to process elements recursively
  function processElement(element: Element, parentStyle: SVGPathStyle, offsetX = 0, offsetY = 0): void {
    // Skip non-visual definition elements entirely
    if (isNonVisualElement(element.tagName)) {
      return;
    }

    const currentStyle = inheritStyle(extractStyle(element), parentStyle);

    // Handle <use> elements by resolving their references
    if (element.tagName === 'use') {
      const href = getUseHref(element);
      if (href && href.startsWith('#')) {
        const refId = href.slice(1);

        // Avoid infinite loops from circular references
        if (processedUseRefs.has(refId)) {
          return;
        }
        processedUseRefs.add(refId);

        const referencedElement = doc.getElementById(refId);
        if (referencedElement) {
          // Get x, y offset from <use> element
          const useX = parseFloat(element.getAttribute('x') || '0');
          const useY = parseFloat(element.getAttribute('y') || '0');

          // Process the referenced element with the combined offset
          processElement(referencedElement, currentStyle, offsetX + useX, offsetY + useY);
        }

        processedUseRefs.delete(refId);
      }
      return;
    }

    if (element.tagName === 'path') {
      const d = element.getAttribute('d');
      if (d) {
        try {
          const commands = makeAbsolute(parseSVG(d));
          const bounds = calculatePathBounds(commands);

          // Apply offset from <use> element if any
          const finalPathData = (offsetX !== 0 || offsetY !== 0)
            ? translatePathData(d, offsetX, offsetY)
            : d;
          const finalBounds = {
            x: bounds.x + offsetX,
            y: bounds.y + offsetY,
            width: bounds.width,
            height: bounds.height,
          };

          paths.push({
            pathData: finalPathData,
            commands: (offsetX !== 0 || offsetY !== 0) ? makeAbsolute(parseSVG(finalPathData)) : commands,
            style: currentStyle,
            bounds: finalBounds,
          });
        } catch (e) {
          console.warn('Failed to parse path:', d, e);
        }
      }
    }

    // Also handle basic shapes by converting to paths
    if (element.tagName === 'rect') {
      const x = parseFloat(element.getAttribute('x') || '0') + offsetX;
      const y = parseFloat(element.getAttribute('y') || '0') + offsetY;
      const width = parseFloat(element.getAttribute('width') || '0');
      const height = parseFloat(element.getAttribute('height') || '0');
      const rx = parseFloat(element.getAttribute('rx') || '0');
      const ry = parseFloat(element.getAttribute('ry') || rx.toString());

      if (width > 0 && height > 0) {
        let d: string;
        if (rx > 0 || ry > 0) {
          // Rounded rectangle
          const r = Math.min(rx, width / 2);
          const r2 = Math.min(ry, height / 2);
          d = `M${x + r},${y} h${width - 2 * r} a${r},${r2} 0 0 1 ${r},${r2} v${height - 2 * r2} a${r},${r2} 0 0 1 -${r},${r2} h-${width - 2 * r} a${r},${r2} 0 0 1 -${r},-${r2} v-${height - 2 * r2} a${r},${r2} 0 0 1 ${r},-${r2} z`;
        } else {
          d = `M${x},${y} h${width} v${height} h-${width} z`;
        }

        const commands = makeAbsolute(parseSVG(d));
        paths.push({
          pathData: d,
          commands,
          style: currentStyle,
          bounds: { x, y, width, height },
        });
      }
    }

    if (element.tagName === 'circle') {
      const cx = parseFloat(element.getAttribute('cx') || '0') + offsetX;
      const cy = parseFloat(element.getAttribute('cy') || '0') + offsetY;
      const r = parseFloat(element.getAttribute('r') || '0');

      if (r > 0) {
        // Convert circle to path using arcs
        const d = `M${cx - r},${cy} a${r},${r} 0 1 0 ${2 * r},0 a${r},${r} 0 1 0 -${2 * r},0`;
        const commands = makeAbsolute(parseSVG(d));
        paths.push({
          pathData: d,
          commands,
          style: currentStyle,
          bounds: { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r },
        });
      }
    }

    if (element.tagName === 'ellipse') {
      const cx = parseFloat(element.getAttribute('cx') || '0') + offsetX;
      const cy = parseFloat(element.getAttribute('cy') || '0') + offsetY;
      const rx = parseFloat(element.getAttribute('rx') || '0');
      const ry = parseFloat(element.getAttribute('ry') || '0');

      if (rx > 0 && ry > 0) {
        const d = `M${cx - rx},${cy} a${rx},${ry} 0 1 0 ${2 * rx},0 a${rx},${ry} 0 1 0 -${2 * rx},0`;
        const commands = makeAbsolute(parseSVG(d));
        paths.push({
          pathData: d,
          commands,
          style: currentStyle,
          bounds: { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry },
        });
      }
    }

    if (element.tagName === 'line') {
      const x1 = parseFloat(element.getAttribute('x1') || '0') + offsetX;
      const y1 = parseFloat(element.getAttribute('y1') || '0') + offsetY;
      const x2 = parseFloat(element.getAttribute('x2') || '0') + offsetX;
      const y2 = parseFloat(element.getAttribute('y2') || '0') + offsetY;

      const d = `M${x1},${y1} L${x2},${y2}`;
      const commands = makeAbsolute(parseSVG(d));
      paths.push({
        pathData: d,
        commands,
        style: currentStyle,
        bounds: {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        },
      });
    }

    if (element.tagName === 'polygon' || element.tagName === 'polyline') {
      const points = element.getAttribute('points');
      if (points) {
        const coords = points.trim().split(/[\s,]+/).map(parseFloat);
        if (coords.length >= 4 && coords.every((n) => !isNaN(n))) {
          // Apply offset to all coordinates
          let d = `M${coords[0] + offsetX},${coords[1] + offsetY}`;
          for (let i = 2; i < coords.length; i += 2) {
            d += ` L${coords[i] + offsetX},${coords[i + 1] + offsetY}`;
          }
          if (element.tagName === 'polygon') {
            d += ' Z';
          }

          const commands = makeAbsolute(parseSVG(d));
          const bounds = calculatePathBounds(commands);
          paths.push({
            pathData: d,
            commands,
            style: currentStyle,
            bounds,
          });
        }
      }
    }

    // Process children with the same offset
    for (const child of element.children) {
      processElement(child, currentStyle, offsetX, offsetY);
    }
  }

  // Start processing from SVG root
  processElement(svgElement, rootStyle);

  // Calculate combined bounds
  const allBounds = paths.map((p) => p.bounds);
  const combinedBounds = allBounds.length > 0
    ? combineBounds(allBounds)
    : viewBox || (dimensions ? { x: 0, y: 0, ...dimensions } : { x: 0, y: 0, width: 100, height: 100 });

  return {
    paths,
    bounds: combinedBounds,
    viewBox,
    dimensions,
  };
}

/**
 * Parse an SVG file
 */
export async function parseSVGFile(file: File): Promise<ParsedSVG> {
  const text = await file.text();
  return parseSVGString(text);
}

/**
 * Check if a string looks like SVG content
 */
export function isSVGString(str: string): boolean {
  const trimmed = str.trim().toLowerCase();
  return trimmed.startsWith('<svg') || trimmed.startsWith('<?xml');
}

/**
 * Try to extract SVG from a string (handles wrapped SVG in HTML, etc.)
 */
export function extractSVGFromString(str: string): string | null {
  // First check if it's a direct SVG
  const trimmed = str.trim();
  if (trimmed.toLowerCase().startsWith('<svg') || trimmed.toLowerCase().startsWith('<?xml')) {
    return trimmed;
  }

  // Try to extract SVG from HTML/text
  const svgMatch = str.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch) {
    return svgMatch[0];
  }

  return null;
}

/**
 * Check if a file is an SVG
 */
export function isSVGFile(file: File): boolean {
  return file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
}

/**
 * Normalize bounds to start at origin (0,0) and return transform offset
 */
export function normalizeBounds(bounds: { x: number; y: number; width: number; height: number }): {
  normalizedBounds: { x: number; y: number; width: number; height: number };
  offset: { x: number; y: number };
} {
  return {
    normalizedBounds: {
      x: 0,
      y: 0,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    },
    offset: {
      x: -bounds.x,
      y: -bounds.y,
    },
  };
}

/**
 * Translate path data by an offset
 */
export function translatePathData(pathData: string, offsetX: number, offsetY: number): string {
  if (offsetX === 0 && offsetY === 0) return pathData;

  const commands = makeAbsolute(parseSVG(pathData));
  let result = '';

  for (const cmd of commands) {
    switch (cmd.code) {
      case 'M':
      case 'L':
      case 'T':
        result += `${cmd.code}${cmd.x + offsetX},${cmd.y + offsetY}`;
        break;
      case 'H':
        result += `H${cmd.x + offsetX}`;
        break;
      case 'V':
        result += `V${cmd.y + offsetY}`;
        break;
      case 'C':
        result += `C${cmd.x1 + offsetX},${cmd.y1 + offsetY} ${cmd.x2 + offsetX},${cmd.y2 + offsetY} ${cmd.x + offsetX},${cmd.y + offsetY}`;
        break;
      case 'S':
        result += `S${cmd.x2 + offsetX},${cmd.y2 + offsetY} ${cmd.x + offsetX},${cmd.y + offsetY}`;
        break;
      case 'Q':
        result += `Q${cmd.x1 + offsetX},${cmd.y1 + offsetY} ${cmd.x + offsetX},${cmd.y + offsetY}`;
        break;
      case 'A':
        result += `A${cmd.rx},${cmd.ry} ${cmd.xAxisRotation} ${cmd.largeArc ? 1 : 0} ${cmd.sweep ? 1 : 0} ${cmd.x + offsetX},${cmd.y + offsetY}`;
        break;
      case 'Z':
        result += 'Z';
        break;
    }
  }

  return result;
}

// =============================================================================
// Hierarchical SVG Structure Parsing
// =============================================================================

import type { SVGStructure, SVGNode, SVGBounds, SVGNodeStyle } from '../types/assets';

/**
 * Parse an SVG string into a hierarchical structure that preserves group hierarchy.
 * This is used for smart splitting later.
 */
export function parseSVGStructure(svgString: string): SVGStructure {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid SVG: ${parseError.textContent}`);
  }

  const svgElement = doc.querySelector('svg');
  if (!svgElement) {
    throw new Error('No SVG element found');
  }

  // Extract viewBox
  let viewBox: SVGBounds | undefined;
  const viewBoxAttr = svgElement.getAttribute('viewBox');
  if (viewBoxAttr) {
    const parts = viewBoxAttr.split(/[\s,]+/).map(parseFloat);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  }

  // Extract dimensions
  let dimensions: { width: number; height: number } | undefined;
  const widthAttr = svgElement.getAttribute('width');
  const heightAttr = svgElement.getAttribute('height');
  if (widthAttr && heightAttr) {
    const width = parseFloat(widthAttr);
    const height = parseFloat(heightAttr);
    if (!isNaN(width) && !isNaN(height)) {
      dimensions = { width, height };
    }
  }

  // Get root style
  const rootStyle = extractStyle(svgElement);

  let nodeCounter = 0;

  // Track processed <use> references to avoid infinite loops
  const processedUseRefs = new Set<string>();

  /**
   * Convert style to SVGNodeStyle format
   */
  function toNodeStyle(style: SVGPathStyle): SVGNodeStyle {
    return {
      fill: style.fill,
      fillOpacity: style.fillOpacity,
      fillRule: style.fillRule,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeOpacity: style.strokeOpacity,
    };
  }

  /**
   * Recursively build node tree
   */
  function buildNode(element: Element, parentStyle: SVGPathStyle, depth: number): SVGNode | null {
    const tagName = element.tagName.toLowerCase();

    // Skip non-visual definition elements entirely
    if (isNonVisualElement(tagName)) {
      return null;
    }

    const currentStyle = inheritStyle(extractStyle(element), parentStyle);
    const transform = element.getAttribute('transform') || undefined;
    const elementId = element.id || undefined;

    // Handle <use> elements by resolving their references
    if (tagName === 'use') {
      const href = getUseHref(element);
      if (href && href.startsWith('#')) {
        const refId = href.slice(1);

        // Avoid infinite loops from circular references
        if (processedUseRefs.has(refId)) {
          return null;
        }
        processedUseRefs.add(refId);

        const referencedElement = doc.getElementById(refId);
        if (referencedElement) {
          // Get x, y offset from <use> element
          const useX = parseFloat(element.getAttribute('x') || '0');
          const useY = parseFloat(element.getAttribute('y') || '0');

          // Build the referenced element and apply offset via transform
          const refNode = buildNode(referencedElement, currentStyle, depth);
          processedUseRefs.delete(refId);

          if (refNode) {
            // Add the use element's position as a transform
            const useTransform = (useX !== 0 || useY !== 0)
              ? `translate(${useX}, ${useY})${transform ? ' ' + transform : ''}`
              : transform;

            return {
              ...refNode,
              transform: useTransform || refNode.transform,
            };
          }
        }
        processedUseRefs.delete(refId);
      }
      return null;
    }

    // Handle groups - recurse into children
    if (tagName === 'g') {
      const children: SVGNode[] = [];
      for (const child of element.children) {
        const childNode = buildNode(child, currentStyle, depth + 1);
        if (childNode) children.push(childNode);
      }
      if (children.length === 0) return null;

      // Combine bounds of all children
      const childBounds = children.map((c) => c.bounds);
      const bounds = combineBounds(childBounds);

      return {
        id: elementId,
        name: elementId || `Group ${++nodeCounter}`,
        type: 'group',
        bounds,
        children,
        transform,
      };
    }

    // Handle path elements
    if (tagName === 'path') {
      const d = element.getAttribute('d');
      if (!d) return null;

      try {
        const commands = makeAbsolute(parseSVG(d));
        const bounds = calculatePathBounds(commands);
        return {
          id: elementId,
          name: elementId || `Path ${++nodeCounter}`,
          type: 'path',
          bounds,
          style: toNodeStyle(currentStyle),
          pathData: d,
          transform,
        };
      } catch {
        return null;
      }
    }

    // Handle rect elements
    if (tagName === 'rect') {
      const x = parseFloat(element.getAttribute('x') || '0');
      const y = parseFloat(element.getAttribute('y') || '0');
      const width = parseFloat(element.getAttribute('width') || '0');
      const height = parseFloat(element.getAttribute('height') || '0');
      const rx = parseFloat(element.getAttribute('rx') || '0');
      const ry = parseFloat(element.getAttribute('ry') || rx.toString());

      if (width <= 0 || height <= 0) return null;

      let d: string;
      if (rx > 0 || ry > 0) {
        const r = Math.min(rx, width / 2);
        const r2 = Math.min(ry, height / 2);
        d = `M${x + r},${y} h${width - 2 * r} a${r},${r2} 0 0 1 ${r},${r2} v${height - 2 * r2} a${r},${r2} 0 0 1 -${r},${r2} h-${width - 2 * r} a${r},${r2} 0 0 1 -${r},-${r2} v-${height - 2 * r2} a${r},${r2} 0 0 1 ${r},-${r2} z`;
      } else {
        d = `M${x},${y} h${width} v${height} h-${width} z`;
      }

      return {
        id: elementId,
        name: elementId || `Rect ${++nodeCounter}`,
        type: 'rect',
        bounds: { x, y, width, height },
        style: toNodeStyle(currentStyle),
        pathData: d,
        transform,
      };
    }

    // Handle circle elements
    if (tagName === 'circle') {
      const cx = parseFloat(element.getAttribute('cx') || '0');
      const cy = parseFloat(element.getAttribute('cy') || '0');
      const r = parseFloat(element.getAttribute('r') || '0');

      if (r <= 0) return null;

      const d = `M${cx - r},${cy} a${r},${r} 0 1 0 ${2 * r},0 a${r},${r} 0 1 0 -${2 * r},0`;
      return {
        id: elementId,
        name: elementId || `Circle ${++nodeCounter}`,
        type: 'circle',
        bounds: { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r },
        style: toNodeStyle(currentStyle),
        pathData: d,
        transform,
      };
    }

    // Handle ellipse elements
    if (tagName === 'ellipse') {
      const cx = parseFloat(element.getAttribute('cx') || '0');
      const cy = parseFloat(element.getAttribute('cy') || '0');
      const rx = parseFloat(element.getAttribute('rx') || '0');
      const ry = parseFloat(element.getAttribute('ry') || '0');

      if (rx <= 0 || ry <= 0) return null;

      const d = `M${cx - rx},${cy} a${rx},${ry} 0 1 0 ${2 * rx},0 a${rx},${ry} 0 1 0 -${2 * rx},0`;
      return {
        id: elementId,
        name: elementId || `Ellipse ${++nodeCounter}`,
        type: 'ellipse',
        bounds: { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry },
        style: toNodeStyle(currentStyle),
        pathData: d,
        transform,
      };
    }

    // Handle line elements
    if (tagName === 'line') {
      const x1 = parseFloat(element.getAttribute('x1') || '0');
      const y1 = parseFloat(element.getAttribute('y1') || '0');
      const x2 = parseFloat(element.getAttribute('x2') || '0');
      const y2 = parseFloat(element.getAttribute('y2') || '0');

      const d = `M${x1},${y1} L${x2},${y2}`;
      return {
        id: elementId,
        name: elementId || `Line ${++nodeCounter}`,
        type: 'line',
        bounds: {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1) || 1,
          height: Math.abs(y2 - y1) || 1,
        },
        style: toNodeStyle(currentStyle),
        pathData: d,
        transform,
      };
    }

    // Handle polygon and polyline elements
    if (tagName === 'polygon' || tagName === 'polyline') {
      const points = element.getAttribute('points');
      if (!points) return null;

      const coords = points.trim().split(/[\s,]+/).map(parseFloat);
      if (coords.length < 4 || !coords.every((n) => !isNaN(n))) return null;

      let d = `M${coords[0]},${coords[1]}`;
      for (let i = 2; i < coords.length; i += 2) {
        d += ` L${coords[i]},${coords[i + 1]}`;
      }
      if (tagName === 'polygon') d += ' Z';

      const commands = makeAbsolute(parseSVG(d));
      const bounds = calculatePathBounds(commands);

      return {
        id: elementId,
        name: elementId || `${tagName === 'polygon' ? 'Polygon' : 'Polyline'} ${++nodeCounter}`,
        type: tagName as 'polygon' | 'polyline',
        bounds,
        style: toNodeStyle(currentStyle),
        pathData: d,
        transform,
      };
    }

    // Skip unhandled elements but process their children (e.g., <defs>, <use>, etc.)
    const children: SVGNode[] = [];
    for (const child of element.children) {
      const childNode = buildNode(child, currentStyle, depth + 1);
      if (childNode) children.push(childNode);
    }

    // If we found children, return as implicit group
    if (children.length > 0) {
      const childBounds = children.map((c) => c.bounds);
      const bounds = combineBounds(childBounds);
      return {
        name: `Container ${++nodeCounter}`,
        type: 'group',
        bounds,
        children,
      };
    }

    return null;
  }

  // Build root node from SVG element's children
  const children: SVGNode[] = [];
  for (const child of svgElement.children) {
    const childNode = buildNode(child, rootStyle, 0);
    if (childNode) children.push(childNode);
  }

  // Create root node
  const rootBounds = children.length > 0
    ? combineBounds(children.map((c) => c.bounds))
    : viewBox || dimensions ? { x: 0, y: 0, ...(dimensions || { width: 100, height: 100 }) } : { x: 0, y: 0, width: 100, height: 100 };

  const root: SVGNode = {
    name: 'root',
    type: 'group',
    bounds: rootBounds,
    children: children.length > 0 ? children : undefined,
  };

  return { viewBox, dimensions, root };
}
