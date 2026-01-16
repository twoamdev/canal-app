/**
 * Properties Panel
 *
 * Sidebar panel that displays and edits properties of the selected node.
 * - Resizable with mouse drag
 * - Min width: 250px, Max width: 500px
 * - Displays different editors based on node type
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { usePanelStore } from '../../stores/panelStore';
import { useGraphStore } from '../../stores/graphStore';
import { useAssetStore } from '../../stores/assetStore';
import { useCompositionStore } from '../../stores/compositionStore';
import { useLayerStore } from '../../stores/layerStore';
import { isSourceNode, isOperationNode } from '../../types/scene-graph';
import type { SourceNode, OperationNode, BlurParams, ColorCorrectParams } from '../../types/scene-graph';
import { isVideoAsset, getAssetDimensions } from '../../types/assets';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { X, GripVertical, CircleDot, Palette, Move, FileVideo, Image, Shapes, Layers } from 'lucide-react';

// =============================================================================
// Source Node Properties Editor
// =============================================================================

interface SourceNodeEditorProps {
  node: SourceNode;
}

function SourceNodeEditor({ node }: SourceNodeEditorProps) {
  const assets = useAssetStore((s) => s.assets);
  const layer = useLayerStore((s) => s.layers[node.layerId]);
  const updateLayer = useLayerStore((s) => s.updateLayer);

  // Early return if layer not found
  if (!layer) {
    return (
      <div className="py-4 text-center text-muted-foreground/60">
        Layer not found
      </div>
    );
  }

  const asset = assets[layer.assetId];
  const dimensions = asset ? getAssetDimensions(asset) : { width: 0, height: 0 };

  // Get icon based on asset type
  const getAssetIcon = () => {
    if (!asset) return FileVideo;
    switch (asset.type) {
      case 'video': return FileVideo;
      case 'image': return Image;
      case 'shape': return Shapes;
      case 'composition': return Layers;
      default: return FileVideo;
    }
  };

  const IconComponent = getAssetIcon();

  // Update time range
  const updateTimeRange = useCallback(
    (field: 'inFrame' | 'outFrame' | 'sourceOffset', value: number) => {
      updateLayer(layer.id, {
        timeRange: {
          ...layer.timeRange,
          [field]: value,
        },
      });
    },
    [layer.id, layer.timeRange, updateLayer]
  );

  // Update transform
  const updateTransform = useCallback(
    (field: string, value: number) => {
      // Handle nested properties like position.x, scale.y
      const parts = field.split('.');
      if (parts.length === 2) {
        const [group, prop] = parts;
        const currentGroup = layer.baseTransform[group as 'position' | 'scale' | 'anchorPoint'];
        if (typeof currentGroup === 'object') {
          updateLayer(layer.id, {
            baseTransform: {
              ...layer.baseTransform,
              [group]: {
                ...currentGroup,
                [prop]: value,
              },
            },
          });
          return;
        }
      }

      // Handle simple properties like rotation, opacity
      updateLayer(layer.id, {
        baseTransform: {
          ...layer.baseTransform,
          [field]: value,
        },
      });
    },
    [layer.id, layer.baseTransform, updateLayer]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <IconComponent className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{layer.name || 'Source'}</h3>
          <p className="text-xs text-muted-foreground capitalize">{asset?.type ?? 'Unknown'}</p>
        </div>
      </div>

      {/* Asset Info */}
      {asset && (
        <Card className="p-3 space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">Asset Info</Label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Width:</span>
              <span className="ml-2 tabular-nums">{dimensions.width}px</span>
            </div>
            <div>
              <span className="text-muted-foreground">Height:</span>
              <span className="ml-2 tabular-nums">{dimensions.height}px</span>
            </div>
            {isVideoAsset(asset) && (
              <>
                <div>
                  <span className="text-muted-foreground">Frames:</span>
                  <span className="ml-2 tabular-nums">{asset.metadata.frameCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">FPS:</span>
                  <span className="ml-2 tabular-nums">{asset.metadata.fps}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="ml-2 tabular-nums">{asset.metadata.duration.toFixed(2)}s</span>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Time Range */}
      <Card className="p-3 space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">Time Range</Label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">In Frame</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{layer.timeRange.inFrame}</span>
          </div>
          <Slider
            value={[layer.timeRange.inFrame]}
            min={0}
            max={Math.max(layer.timeRange.outFrame - 1, 0)}
            step={1}
            onValueChange={(v) => updateTimeRange('inFrame', v[0])}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Out Frame</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{layer.timeRange.outFrame}</span>
          </div>
          <Slider
            value={[layer.timeRange.outFrame]}
            min={layer.timeRange.inFrame + 1}
            max={asset && isVideoAsset(asset) ? asset.metadata.frameCount : 1000}
            step={1}
            onValueChange={(v) => updateTimeRange('outFrame', v[0])}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Source Offset</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{layer.timeRange.sourceOffset}</span>
          </div>
          <Slider
            value={[layer.timeRange.sourceOffset]}
            min={0}
            max={asset && isVideoAsset(asset) ? asset.metadata.frameCount - 1 : 0}
            step={1}
            onValueChange={(v) => updateTimeRange('sourceOffset', v[0])}
          />
        </div>
      </Card>

      {/* Transform */}
      <Card className="p-3 space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">Transform</Label>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Position X</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{layer.baseTransform.position.x}</span>
            </div>
            <Slider
              value={[layer.baseTransform.position.x]}
              min={-1000}
              max={1000}
              step={1}
              onValueChange={(v) => updateTransform('position.x', v[0])}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Position Y</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{layer.baseTransform.position.y}</span>
            </div>
            <Slider
              value={[layer.baseTransform.position.y]}
              min={-1000}
              max={1000}
              step={1}
              onValueChange={(v) => updateTransform('position.y', v[0])}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Scale X</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{layer.baseTransform.scale.x.toFixed(2)}</span>
            </div>
            <Slider
              value={[layer.baseTransform.scale.x]}
              min={0}
              max={4}
              step={0.01}
              onValueChange={(v) => updateTransform('scale.x', v[0])}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Scale Y</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{layer.baseTransform.scale.y.toFixed(2)}</span>
            </div>
            <Slider
              value={[layer.baseTransform.scale.y]}
              min={0}
              max={4}
              step={0.01}
              onValueChange={(v) => updateTransform('scale.y', v[0])}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Rotation</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{layer.baseTransform.rotation.toFixed(1)}°</span>
          </div>
          <Slider
            value={[layer.baseTransform.rotation]}
            min={-180}
            max={180}
            step={0.5}
            onValueChange={(v) => updateTransform('rotation', v[0])}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Opacity</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{(layer.baseTransform.opacity * 100).toFixed(0)}%</span>
          </div>
          <Slider
            value={[layer.baseTransform.opacity]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(v) => updateTransform('opacity', v[0])}
          />
        </div>
      </Card>
    </div>
  );
}

// =============================================================================
// Operation Node Properties Editor
// =============================================================================

interface OperationNodeEditorProps {
  node: OperationNode;
}

function OperationNodeEditor({ node }: OperationNodeEditorProps) {
  const updateNode = useGraphStore((s) => s.updateNode);

  // Get icon based on operation type
  const getOperationIcon = () => {
    switch (node.operationType) {
      case 'blur': return CircleDot;
      case 'color_correct': return Palette;
      case 'transform': return Move;
      default: return CircleDot;
    }
  };

  const IconComponent = getOperationIcon();

  // Update a parameter
  const updateParam = useCallback(
    (paramName: string, value: number | boolean | string) => {
      updateNode(node.id, (n) => {
        if (n.type !== 'operation') return {};
        return {
          params: {
            ...n.params,
            [paramName]: value,
          },
        };
      });
    },
    [node.id, updateNode]
  );

  // Render blur controls
  const renderBlurControls = () => {
    const blurParams = node.params as BlurParams;
    const radius = blurParams.radius ?? 10;

    return (
      <Card className="p-3 space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">Blur Settings</Label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Radius</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{radius}px</span>
          </div>
          <Slider
            value={[radius]}
            min={0}
            max={50}
            step={1}
            onValueChange={(v) => updateParam('radius', v[0])}
            disabled={!node.isEnabled}
          />
        </div>
      </Card>
    );
  };

  // Render color correct controls
  const renderColorCorrectControls = () => {
    const colorParams = node.params as ColorCorrectParams;
    const brightness = colorParams.brightness ?? 0;
    const contrast = colorParams.contrast ?? 1;
    const saturation = colorParams.saturation ?? 1;
    const exposure = colorParams.exposure ?? 0;

    return (
      <Card className="p-3 space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">Color Correction</Label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Brightness</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{brightness.toFixed(2)}</span>
          </div>
          <Slider
            value={[brightness]}
            min={-1}
            max={1}
            step={0.01}
            onValueChange={(v) => updateParam('brightness', v[0])}
            disabled={!node.isEnabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Contrast</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{contrast.toFixed(2)}</span>
          </div>
          <Slider
            value={[contrast]}
            min={0}
            max={2}
            step={0.01}
            onValueChange={(v) => updateParam('contrast', v[0])}
            disabled={!node.isEnabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Saturation</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{saturation.toFixed(2)}</span>
          </div>
          <Slider
            value={[saturation]}
            min={0}
            max={2}
            step={0.01}
            onValueChange={(v) => updateParam('saturation', v[0])}
            disabled={!node.isEnabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Exposure</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{exposure.toFixed(2)}</span>
          </div>
          <Slider
            value={[exposure]}
            min={-2}
            max={2}
            step={0.01}
            onValueChange={(v) => updateParam('exposure', v[0])}
            disabled={!node.isEnabled}
          />
        </div>
      </Card>
    );
  };

  // Render transform controls
  const renderTransformControls = () => {
    return (
      <Card className="p-3">
        <div className="py-4 text-center text-muted-foreground/60 border border-dashed border-muted rounded">
          Transform controls coming soon
        </div>
      </Card>
    );
  };

  // Render controls based on operation type
  const renderControls = () => {
    switch (node.operationType) {
      case 'blur':
        return renderBlurControls();
      case 'color_correct':
        return renderColorCorrectControls();
      case 'transform':
        return renderTransformControls();
      default:
        return null;
    }
  };

  const operationLabels: Record<string, string> = {
    blur: 'Blur',
    color_correct: 'Color Correct',
    transform: 'Transform',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <div className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          node.isEnabled ? 'bg-muted' : 'bg-muted/50'
        )}>
          <IconComponent className={cn(
            'w-5 h-5',
            node.isEnabled ? 'text-muted-foreground' : 'text-muted-foreground/50'
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{node.label || operationLabels[node.operationType]}</h3>
          <p className={cn(
            'text-xs',
            node.isEnabled ? 'text-muted-foreground' : 'text-muted-foreground/50'
          )}>
            {node.isEnabled ? 'Enabled' : 'Bypassed'}
          </p>
        </div>
      </div>

      {/* Controls */}
      {renderControls()}
    </div>
  );
}

// =============================================================================
// Properties Panel
// =============================================================================

export function PropertiesPanel() {
  const isOpen = usePanelStore((s) => s.isPropertiesPanelOpen);
  const width = usePanelStore((s) => s.propertiesPanelWidth);
  const closePanel = usePanelStore((s) => s.closePropertiesPanel);
  const setWidth = usePanelStore((s) => s.setPropertiesPanelWidth);

  // Subscribe to composition and assets to get nodes
  const activeCompId = useCompositionStore((s) => s.activeCompositionId);
  const assets = useAssetStore((s) => s.assets);

  // Get selected node from the composition's graph
  const selectedNode = (() => {
    if (!activeCompId) return null;
    const comp = assets[activeCompId];
    if (!comp || comp.type !== 'composition') return null;
    const nodes = Object.values(comp.graph.nodes);
    return nodes.find((n) => n.selected) ?? null;
  })();

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  // Handle resize move/end
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      const newWidth = startWidthRef.current + delta;
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setWidth]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Backslash
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        usePanelStore.getState().togglePropertiesPanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed top-0 right-0 h-full bg-background border-l border-border z-50',
        'flex flex-col shadow-xl',
        isResizing && 'select-none'
      )}
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize',
          'hover:bg-primary/50 transition-colors',
          isResizing && 'bg-primary'
        )}
        onMouseDown={handleResizeStart}
      >
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-8 flex items-center justify-center">
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-sm">Properties</h2>
        <button
          onClick={closePanel}
          className="p-1 rounded hover:bg-muted transition-colors"
          title="Close panel (Cmd/Ctrl + \)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedNode ? (
          <>
            {isSourceNode(selectedNode) && (
              <SourceNodeEditor node={selectedNode} />
            )}
            {isOperationNode(selectedNode) && (
              <OperationNodeEditor node={selectedNode} />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">No node selected</p>
            <p className="text-xs mt-1">Select a node to view its properties</p>
          </div>
        )}
      </div>
    </div>
  );
}
