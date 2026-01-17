/**
 * useClipboardPaste Hook
 *
 * Handles clipboard paste events to create assets from pasted content.
 * Supports:
 * - SVG content (text/plain or image/svg+xml)
 *   - Multi-path SVGs are split into individual shape assets + GroupNode
 * - Images (image/png, image/jpeg, etc.)
 */

import { useEffect, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';
import { useLayerStore } from '../stores/layerStore';
import { useGroupStore } from '../stores/groupStore';
import {
  createSplitShapeAssetsFromSVGString,
  createPlaceholderImageAsset,
  createImageAsset,
} from '../utils/asset-factory';
import { extractSVGFromString } from '../utils/svg-parser';
import {
  createSourceNode,
  createLayer,
  createGroup,
  createGroupNode,
} from '../types/scene-graph';

export function useClipboardPaste() {
  const { getViewport } = useReactFlow();
  const addAsset = useAssetStore((state) => state.addAsset);
  const updateAsset = useAssetStore((state) => state.updateAsset);
  const addNode = useGraphStore((state) => state.addNode);
  const addEdge = useGraphStore((state) => state.addEdge);
  const addLayer = useLayerStore((state) => state.addLayer);
  const updateLayer = useLayerStore((state) => state.updateLayer);
  const addGroup = useGroupStore((state) => state.addGroup);

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

      // Calculate position at center of viewport
      const viewport = getViewport();
      const centerX = (-viewport.x + window.innerWidth / 2) / viewport.zoom;
      const centerY = (-viewport.y + window.innerHeight / 2) / viewport.zoom;

      // Helper to create shapes from SVG string (handles multi-path splitting)
      const createShapesFromSVG = (svgString: string, name: string) => {
        const splitResult = createSplitShapeAssetsFromSVGString(svgString, name);
        const { assets } = splitResult;

        if (assets.length === 0) {
          console.warn('[Clipboard] No paths found in SVG');
          return;
        }

        // Single path - simple case, just create one node
        if (assets.length === 1) {
          const shapeAsset = assets[0];
          addAsset(shapeAsset);

          const layer = createLayer(shapeAsset.id, shapeAsset.name, 1);
          addLayer(layer);

          const sourceNode = createSourceNode(layer.id, {
            x: centerX - 100,
            y: centerY - 100,
          });
          addNode(sourceNode);

          console.log(
            `[Clipboard] Created shape: ${shapeAsset.intrinsicWidth}x${shapeAsset.intrinsicHeight}`
          );
          return;
        }

        // Multiple paths - create individual nodes and wire to GroupNode
        console.log(`[Clipboard] Splitting SVG into ${assets.length} paths`);

        const sourceNodeIds: string[] = [];

        // Layout constants
        const nodeWidth = 220;
        const nodeSpacing = 30;
        const startX = centerX - (assets.length * (nodeWidth + nodeSpacing)) / 2;

        // Create assets, layers, and source nodes for each path
        // Process in SVG order (first = bottom of stack)
        assets.forEach((shapeAsset, index) => {
          addAsset(shapeAsset);

          const layer = createLayer(shapeAsset.id, shapeAsset.name, 1);
          addLayer(layer);

          // Set layer position from the original SVG position
          
          const originalPos = shapeAsset.metadata.originalPosition;
          if (originalPos) {
            updateLayer(layer.id, {
              baseTransform: {
                ...layer.baseTransform,
                position: { x: originalPos.x, y: originalPos.y },
              },
            });
          }
          

          // Position source nodes horizontally
          const nodeX = startX + index * (nodeWidth + nodeSpacing);
          const sourceNode = createSourceNode(layer.id, {
            x: nodeX,
            y: centerY - 150,
          });
          addNode(sourceNode);
          sourceNodeIds.push(sourceNode.id);

          console.log(
            `[Clipboard] Created path ${index + 1}: ${shapeAsset.name}`
          );
        });

        // Create a Group to hold all layers (in order: first = bottom)
        // Create Group with empty members - connections will populate memberIds
        const group = createGroup(name, [], 1);
        addGroup(group);

        // Create GroupNode positioned below the source nodes
        const groupNode = createGroupNode(group.id, name, {
          x: centerX - nodeWidth / 2,
          y: centerY + 100,
        });
        addNode(groupNode);

        // Connect all source nodes to the group node in order (index 0 = input-0 = bottom layer)
        sourceNodeIds.forEach((sourceId, index) => {
          addEdge({
            id: `edge_svg_${Date.now()}_${index}`,
            source: sourceId,
            target: groupNode.id,
            targetHandle: `input-${index}`,
          });
        });

        console.log(
          `[Clipboard] Created GroupNode "${name}" with ${assets.length} layers`
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
            createShapesFromSVG(svgContent, 'Pasted SVG');
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
            createShapesFromSVG(svgContent, 'Pasted SVG');
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
              createShapesFromSVG(svgText, 'Pasted SVG');
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

              const layer = createLayer(placeholderAsset.id, placeholderAsset.name, 1);
              addLayer(layer);

              const sourceNode = createSourceNode(layer.id, {
                x: centerX - 100,
                y: centerY - 100,
              });
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
    [addAsset, updateAsset, addNode, addEdge, addLayer, updateLayer, addGroup, getViewport]
  );

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [handlePaste]);
}
