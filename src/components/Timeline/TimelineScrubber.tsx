import { useRef, useCallback, useEffect, useState } from 'react';
import { useTimelineStore } from '../../stores/timelineStore';
import { Repeat } from 'lucide-react';

// Tick spacing configuration
const MIN_TICK_SPACING = 8; // Minimum pixels between minor ticks
const MAJOR_TICK_INTERVALS = [1, 5, 10, 15, 30, 60, 120, 300]; // Frame intervals for major ticks

export function TimelineScrubber() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const currentFrame = useTimelineStore((state) => state.currentFrame);
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const isLooping = useTimelineStore((state) => state.isLooping);
  const fps = useTimelineStore((state) => state.fps);
  const setCurrentFrame = useTimelineStore((state) => state.setCurrentFrame);
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

  // Calculate tick configuration based on available width
  const tickConfig = useCallback(() => {
    if (trackWidth === 0 || totalFrames === 0) {
      return { minorInterval: 1, majorInterval: 10, pixelsPerFrame: 0 };
    }

    const pixelsPerFrame = trackWidth / totalFrames;

    // Find appropriate minor tick interval
    let minorInterval = 1;
    for (const interval of [1, 2, 5, 10, 15, 30, 60]) {
      if (pixelsPerFrame * interval >= MIN_TICK_SPACING) {
        minorInterval = interval;
        break;
      }
      minorInterval = interval;
    }

    // Find appropriate major tick interval (should be multiple of minor)
    let majorInterval = minorInterval * 5;
    for (const interval of MAJOR_TICK_INTERVALS) {
      if (interval >= minorInterval * 5 && interval % minorInterval === 0) {
        majorInterval = interval;
        break;
      }
    }

    return { minorInterval, majorInterval, pixelsPerFrame };
  }, [trackWidth, totalFrames]);

  const { minorInterval, majorInterval, pixelsPerFrame } = tickConfig();

  // Generate tick marks
  const ticks = useCallback(() => {
    const result: Array<{ frame: number; isMajor: boolean; x: number }> = [];

    if (pixelsPerFrame === 0) return result;

    for (let frame = frameStart; frame <= frameEnd; frame += minorInterval) {
      const isMajor = frame % majorInterval === 0;
      const x = (frame - frameStart) * pixelsPerFrame;
      result.push({ frame, isMajor, x });
    }

    return result;
  }, [frameStart, frameEnd, minorInterval, majorInterval, pixelsPerFrame]);

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
              {isMajor && pixelsPerFrame * majorInterval > 30 && (
                <span
                  className="absolute bottom-5 text-[10px] text-muted-foreground font-mono -translate-x-1/2"
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
    </div>
  );
}
