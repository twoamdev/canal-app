import { useRef, useCallback, useEffect, useState } from 'react';
import { useTimelineStore } from '../../stores/timelineStore';
import { Repeat } from 'lucide-react';

// Tick spacing configuration
const MIN_MINOR_TICK_SPACING = 6; // Minimum pixels between minor ticks
const MIN_MAJOR_TICK_SPACING = 60; // Minimum pixels between major ticks (for labels)

// Nice intervals for tick marks (will be scaled by power of 10)
const NICE_INTERVALS = [1, 2, 5, 10];

export function TimelineScrubber() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Local state for input editing (allows clearing/typing)
  const [inInputValue, setInInputValue] = useState<string>('');
  const [outInputValue, setOutInputValue] = useState<string>('');
  const [isEditingIn, setIsEditingIn] = useState(false);
  const [isEditingOut, setIsEditingOut] = useState(false);

  const currentFrame = useTimelineStore((state) => state.currentFrame);
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const isLooping = useTimelineStore((state) => state.isLooping);
  const fps = useTimelineStore((state) => state.fps);
  const setCurrentFrame = useTimelineStore((state) => state.setCurrentFrame);
  const setFrameRange = useTimelineStore((state) => state.setFrameRange);
  const setIsPlaying = useTimelineStore((state) => state.setIsPlaying);
  const togglePlayback = useTimelineStore((state) => state.togglePlayback);
  const toggleLooping = useTimelineStore((state) => state.toggleLooping);

  // Playback refs
  const playbackRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);

  const totalFrames = frameEnd - frameStart + 1;

  // Measure track width
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTrackWidth(entry.contentRect.width);
      }
    });

    observer.observe(track);
    setTrackWidth(track.clientWidth);

    return () => observer.disconnect();
  }, []);

  // Find a "nice" interval that's >= minInterval
  const getNiceInterval = useCallback((minInterval: number): number => {
    if (minInterval <= 0) return 1;

    // Find the order of magnitude
    const magnitude = Math.pow(10, Math.floor(Math.log10(minInterval)));

    // Find the smallest nice interval >= minInterval
    for (const nice of NICE_INTERVALS) {
      const interval = nice * magnitude;
      if (interval >= minInterval) {
        return interval;
      }
    }
    // Fall back to next magnitude
    return 10 * magnitude;
  }, []);

  // Calculate tick configuration based on available width
  const tickConfig = useCallback(() => {
    if (trackWidth === 0 || totalFrames <= 0) {
      return { minorInterval: 1, majorInterval: 10, pixelsPerFrame: 0 };
    }

    const pixelsPerFrame = trackWidth / totalFrames;

    // Calculate minimum intervals based on pixel spacing requirements
    const minMinorInterval = MIN_MINOR_TICK_SPACING / pixelsPerFrame;
    const minMajorInterval = MIN_MAJOR_TICK_SPACING / pixelsPerFrame;

    // Get nice intervals
    const majorInterval = Math.max(1, getNiceInterval(minMajorInterval));

    // Minor interval should divide evenly into major interval
    // Use 5 minor ticks per major tick, or 2 if that's too dense
    let minorInterval = majorInterval / 5;
    if (minorInterval < minMinorInterval) {
      minorInterval = majorInterval / 2;
    }
    if (minorInterval < minMinorInterval || minorInterval < 1) {
      minorInterval = majorInterval; // No minor ticks, just major
    }

    // Ensure intervals are integers (we're dealing with frames)
    return {
      minorInterval: Math.max(1, Math.round(minorInterval)),
      majorInterval: Math.max(1, Math.round(majorInterval)),
      pixelsPerFrame,
    };
  }, [trackWidth, totalFrames, getNiceInterval]);

  const { minorInterval, majorInterval, pixelsPerFrame } = tickConfig();

  // Generate tick marks
  const ticks = useCallback(() => {
    const result: Array<{ frame: number; isMajor: boolean; x: number }> = [];

    if (pixelsPerFrame === 0 || totalFrames <= 0) return result;

    // Start from the first tick frame that's >= frameStart and aligned to minorInterval
    const firstTick = Math.ceil(frameStart / minorInterval) * minorInterval;

    for (let frame = firstTick; frame <= frameEnd; frame += minorInterval) {
      // A tick is major if it aligns with the major interval
      const isMajor = frame % majorInterval === 0;
      const x = (frame - frameStart) * pixelsPerFrame;
      result.push({ frame, isMajor, x });
    }

    return result;
  }, [frameStart, frameEnd, minorInterval, majorInterval, pixelsPerFrame, totalFrames]);

  // Scrubber position
  const scrubberX = (currentFrame - frameStart) * pixelsPerFrame;

  // Handle scrubbing
  const frameFromX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return currentFrame;

      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      return Math.round(frameStart + ratio * (frameEnd - frameStart));
    },
    [frameStart, frameEnd, currentFrame]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const frame = frameFromX(e.clientX);
      setCurrentFrame(frame);
    },
    [frameFromX, setCurrentFrame]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const frame = frameFromX(e.clientX);
      setCurrentFrame(frame);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, frameFromX, setCurrentFrame]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying || isDragging) {
      if (playbackRef.current) {
        cancelAnimationFrame(playbackRef.current);
        playbackRef.current = null;
      }
      return;
    }

    const frameDuration = 1000 / fps;

    const playFrame = (timestamp: number) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastFrameTimeRef.current;

      if (elapsed >= frameDuration) {
        lastFrameTimeRef.current = timestamp - (elapsed % frameDuration);

        const state = useTimelineStore.getState();
        let nextFrame = state.currentFrame + 1;

        if (nextFrame > state.frameEnd) {
          if (isLooping) {
            nextFrame = state.frameStart;
          } else {
            setIsPlaying(false);
            return;
          }
        }

        setCurrentFrame(nextFrame);
      }

      playbackRef.current = requestAnimationFrame(playFrame);
    };

    lastFrameTimeRef.current = 0;
    playbackRef.current = requestAnimationFrame(playFrame);

    return () => {
      if (playbackRef.current) {
        cancelAnimationFrame(playbackRef.current);
        playbackRef.current = null;
      }
    };
  }, [isPlaying, isDragging, fps, isLooping, setCurrentFrame, setIsPlaying]);

  // Stop playback when dragging starts
  useEffect(() => {
    if (isDragging && isPlaying) {
      setIsPlaying(false);
    }
  }, [isDragging, isPlaying, setIsPlaying]);

  // Spacebar hotkey for play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayback]);

  // Format frame number for display
  const formatFrame = (frame: number) => {
    return frame.toString().padStart(4, '0');
  };

  // Frame In input handlers
  const handleInFocus = useCallback(() => {
    setInInputValue(frameStart.toString());
    setIsEditingIn(true);
  }, [frameStart]);

  const handleInChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInInputValue(e.target.value);
  }, []);

  const handleInBlur = useCallback(() => {
    setIsEditingIn(false);
    const value = parseInt(inInputValue, 10);
    if (!isNaN(value) && value >= 0 && value < frameEnd) {
      setFrameRange(value, frameEnd);
    }
    // Reset to store value (will show on next render)
  }, [inInputValue, frameEnd, setFrameRange]);

  const handleInKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setIsEditingIn(false);
      setInInputValue(frameStart.toString());
    }
  }, [frameStart]);

  // Frame Out input handlers
  const handleOutFocus = useCallback(() => {
    setOutInputValue(frameEnd.toString());
    setIsEditingOut(true);
  }, [frameEnd]);

  const handleOutChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setOutInputValue(e.target.value);
  }, []);

  const handleOutBlur = useCallback(() => {
    setIsEditingOut(false);
    const value = parseInt(outInputValue, 10);
    if (!isNaN(value) && value > frameStart) {
      setFrameRange(frameStart, value);
    }
    // Reset to store value (will show on next render)
  }, [outInputValue, frameStart, setFrameRange]);

  const handleOutKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setIsEditingOut(false);
      setOutInputValue(frameEnd.toString());
    }
  }, [frameEnd]);

  return (
    <div className="h-12 bg-card border-t border-border flex items-stretch select-none">
      {/* Control buttons */}
      <div className="flex items-center px-2 border-r border-border bg-muted/30 gap-1">
        <button
          onClick={toggleLooping}
          className={`p-1.5 rounded transition-colors ${
            isLooping
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          title={isLooping ? 'Loop enabled' : 'Loop disabled'}
        >
          <Repeat className="w-4 h-4" />
        </button>
      </div>

      {/* Frame In input */}
      <div className="flex items-center px-2 border-r border-border bg-muted/30 gap-1">
        <span className="text-[10px] text-muted-foreground uppercase">In</span>
        <input
          type="text"
          inputMode="numeric"
          value={isEditingIn ? inInputValue : frameStart}
          onFocus={handleInFocus}
          onChange={handleInChange}
          onBlur={handleInBlur}
          onKeyDown={handleInKeyDown}
          className="w-16 h-7 px-1.5 text-sm font-mono tabular-nums bg-background border border-border rounded text-center focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Timecode display */}
      <div className="w-20 flex items-center justify-center border-r border-border bg-muted/30">
        <span className="font-mono text-sm text-foreground tabular-nums">
          {formatFrame(currentFrame)}
        </span>
      </div>

      {/* Timeline track */}
      <div
        ref={trackRef}
        className="flex-1 relative cursor-pointer"
        onMouseDown={handleMouseDown}
      >
        {/* Tick marks */}
        <div className="absolute inset-0 overflow-hidden">
          {ticks().map(({ frame, isMajor, x }) => (
            <div
              key={frame}
              className="absolute bottom-0"
              style={{ left: `${x}px` }}
            >
              {/* Tick line */}
              <div
                className={`w-px ${isMajor ? 'h-4 bg-muted-foreground' : 'h-2 bg-muted-foreground/50'}`}
              />
              {/* Frame label for major ticks */}
              {isMajor && (
                <span
                  className="absolute bottom-5 text-[10px] text-muted-foreground font-mono tabular-nums -translate-x-1/2 whitespace-nowrap"
                  style={{ left: 0 }}
                >
                  {frame}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Scrubber head */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `${scrubberX}px`, transform: 'translateX(-50%)' }}
        >
          {/* Arrow head */}
          <div className="relative">
            <svg
              width="12"
              height="8"
              viewBox="0 0 12 8"
              className="absolute top-0 left-1/2 -translate-x-1/2"
            >
              <path
                d="M6 8L0 0H12L6 8Z"
                className="fill-primary"
              />
            </svg>
          </div>
          {/* Vertical line */}
          <div
            className="absolute top-2 bottom-0 w-px bg-primary left-1/2 -translate-x-1/2"
          />
        </div>
      </div>

      {/* Frame Out input */}
      <div className="flex items-center px-2 border-l border-border bg-muted/30 gap-1">
        <span className="text-[10px] text-muted-foreground uppercase">Out</span>
        <input
          type="text"
          inputMode="numeric"
          value={isEditingOut ? outInputValue : frameEnd}
          onFocus={handleOutFocus}
          onChange={handleOutChange}
          onBlur={handleOutBlur}
          onKeyDown={handleOutKeyDown}
          className="w-16 h-7 px-1.5 text-sm font-mono tabular-nums bg-background border border-border rounded text-center focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>
  );
}
