/**
 * useClipboardPaste Hook
 *
 * Handles clipboard paste events to create assets from pasted content.
 * Supports:
 * - SVG content (text/plain or image/svg+xml)
 * - Images (image/png, image/jpeg, etc.)
 */

import { useEffect, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';
import {
  createShapeAssetFromSVGString,
  createPlaceholderImageAsset,
  createImageAsset,
} from '../utils/asset-factory';
import { extractSVGFromString } from '../utils/svg-parser';
import { createSourceNode } from '../types/scene-graph';

export function useClipboardPaste() {
  const { getViewport } = useReactFlow();
  const addAsset = useAssetStore((state) => state.addAsset);
  const updateAsset = useAssetStore((state) => state.updateAsset);
  const addNode = useGraphStore((state) => state.addNode);

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      // Don't handle paste if focused on an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      // Debug logging (uncomment if needed)
      // console.log('[Clipboard] Paste event received, types:', clipboardData.types);

      // Helper to create shape from SVG string
      const createShapeFromSVG = (svgString: string, name: string) => {
        const shapeAsset = createShapeAssetFromSVGString(svgString, name);
        addAsset(shapeAsset);

        // Calculate position at center of viewport
        const viewport = getViewport();
        const centerX = (-viewport.x + window.innerWidth / 2) / viewport.zoom;
        const centerY = (-viewport.y + window.innerHeight / 2) / viewport.zoom;

        // Create source node
        const sourceNode = createSourceNode(
          shapeAsset.id,
          shapeAsset.name,
          1, // Shapes are single frame
          { x: centerX - 100, y: centerY - 100 }
        );
        addNode(sourceNode);

        console.log(
          `[Clipboard] Created shape: ${shapeAsset.intrinsicWidth}x${shapeAsset.intrinsicHeight}`
        );
      };

      // Try to find SVG in various formats
      // 1. Check text/plain
      const textData = clipboardData.getData('text/plain');
      if (textData) {
        const svgContent = extractSVGFromString(textData);
        if (svgContent) {
          event.preventDefault();
          try {
            createShapeFromSVG(svgContent, 'Pasted SVG');
          } catch (error) {
            console.error('Failed to parse pasted SVG from text:', error);
          }
          return;
        }
      }

      // 2. Check text/html
      const htmlData = clipboardData.getData('text/html');
      if (htmlData) {
        const svgContent = extractSVGFromString(htmlData);
        if (svgContent) {
          event.preventDefault();
          try {
            createShapeFromSVG(svgContent, 'Pasted SVG');
          } catch (error) {
            console.error('Failed to parse pasted SVG from HTML:', error);
          }
          return;
        }
      }

      // 3. Check clipboard items (files/blobs)
      const items = clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type === 'image/svg+xml') {
          event.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            try {
              const svgText = await blob.text();
              createShapeFromSVG(svgText, 'Pasted SVG');
            } catch (error) {
              console.error('Failed to parse pasted SVG image:', error);
            }
          }
          return;
        }

        if (item.type.startsWith('image/')) {
          event.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            try {
              const file = new File([blob], `pasted-image.${item.type.split('/')[1]}`, {
                type: item.type,
              });

              const placeholderAsset = createPlaceholderImageAsset(file);
              addAsset(placeholderAsset);

              const viewport = getViewport();
              const centerX = (-viewport.x + window.innerWidth / 2) / viewport.zoom;
              const centerY = (-viewport.y + window.innerHeight / 2) / viewport.zoom;

              const sourceNode = createSourceNode(
                placeholderAsset.id,
                placeholderAsset.name,
                1,
                { x: centerX - 100, y: centerY - 100 }
              );
              addNode(sourceNode);

              const processedAsset = await createImageAsset(file);

              updateAsset(placeholderAsset.id, {
                intrinsicWidth: processedAsset.intrinsicWidth,
                intrinsicHeight: processedAsset.intrinsicHeight,
                metadata: processedAsset.metadata,
                loadingState: undefined,
              });

              console.log(
                `[Clipboard] Pasted image: ${processedAsset.intrinsicWidth}x${processedAsset.intrinsicHeight}`
              );
            } catch (error) {
              console.error('Failed to process pasted image:', error);
            }
          }
          return;
        }
      }

    },
    [addAsset, updateAsset, addNode, getViewport]
  );

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [handlePaste]);
}
