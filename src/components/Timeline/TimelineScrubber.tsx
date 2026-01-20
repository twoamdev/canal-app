import { useRef, useCallback, useEffect, useState } from 'react';
import { useTimelineStore } from '../../stores/timelineStore';

// Tick spacing configuration
const MIN_MINOR_TICK_SPACING = 8;
const MIN_MAJOR_TICK_SPACING = 40;

// Nice intervals for tick marks
const NICE_INTERVALS = [1, 2, 5, 10];

export function TimelineScrubber() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Local state for input editing
  const [startInputValue, setStartInputValue] = useState<string>('');
  const [endInputValue, setEndInputValue] = useState<string>('');
  const [isEditingStart, setIsEditingStart] = useState(false);
  const [isEditingEnd, setIsEditingEnd] = useState(false);

  const currentFrame = useTimelineStore((state) => state.currentFrame);
  const frameStart = useTimelineStore((state) => state.frameStart);
  const frameEnd = useTimelineStore((state) => state.frameEnd);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const fps = useTimelineStore((state) => state.fps);
  const setCurrentFrame = useTimelineStore((state) => state.setCurrentFrame);
  const setFrameRange = useTimelineStore((state) => state.setFrameRange);
  const setIsPlaying = useTimelineStore((state) => state.setIsPlaying);
  const togglePlayback = useTimelineStore((state) => state.togglePlayback);
  const triggerPauseUpdate = useTimelineStore((state) => state.triggerPauseUpdate);

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

  // Find a "nice" interval
  const getNiceInterval = useCallback((minInterval: number): number => {
    if (minInterval <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(minInterval)));
    for (const nice of NICE_INTERVALS) {
      const interval = nice * magnitude;
      if (interval >= minInterval) {
        return interval;
      }
    }
    return 10 * magnitude;
  }, []);

  // Calculate tick configuration
  const tickConfig = useCallback(() => {
    if (trackWidth === 0 || totalFrames <= 0) {
      return { minorInterval: 1, majorInterval: 10, pixelsPerFrame: 0 };
    }

    const pixelsPerFrame = trackWidth / totalFrames;
    const minMinorInterval = MIN_MINOR_TICK_SPACING / pixelsPerFrame;
    const minMajorInterval = MIN_MAJOR_TICK_SPACING / pixelsPerFrame;
    const majorInterval = Math.max(1, getNiceInterval(minMajorInterval));

    let minorInterval = majorInterval / 5;
    if (minorInterval < minMinorInterval) {
      minorInterval = majorInterval / 2;
    }
    if (minorInterval < minMinorInterval || minorInterval < 1) {
      minorInterval = majorInterval;
    }

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

    const firstTick = Math.ceil(frameStart / minorInterval) * minorInterval;

    for (let frame = firstTick; frame <= frameEnd; frame += minorInterval) {
      const isMajor = frame % majorInterval === 0;
      const x = (frame - frameStart) * pixelsPerFrame;
      result.push({ frame, isMajor, x });
    }

    return result;
  }, [frameStart, frameEnd, minorInterval, majorInterval, pixelsPerFrame, totalFrames]);

  // Scrubber position (percentage for positioning)
  const scrubberPercent = totalFrames > 0 ? ((currentFrame - frameStart) / (frameEnd - frameStart)) * 100 : 0;

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
      // Trigger pause update so all nodes refresh to show the current frame
      triggerPauseUpdate();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, frameFromX, setCurrentFrame, triggerPauseUpdate]);

  // Playback loop - always loops by default
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
          // Always loop
          nextFrame = state.frameStart;
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
  }, [isPlaying, isDragging, fps, setCurrentFrame, setIsPlaying]);

  // Stop playback when dragging starts
  useEffect(() => {
    if (isDragging && isPlaying) {
      setIsPlaying(false);
    }
  }, [isDragging, isPlaying, setIsPlaying]);

  // Spacebar hotkey for play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  // Start frame input handlers
  const handleStartFocus = useCallback(() => {
    setStartInputValue(frameStart.toString());
    setIsEditingStart(true);
  }, [frameStart]);

  const handleStartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setStartInputValue(e.target.value);
  }, []);

  const handleStartBlur = useCallback(() => {
    setIsEditingStart(false);
    const value = parseInt(startInputValue, 10);
    if (!isNaN(value) && value >= 0 && value < frameEnd) {
      setFrameRange(value, frameEnd);
    }
  }, [startInputValue, frameEnd, setFrameRange]);

  const handleStartKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setIsEditingStart(false);
      setStartInputValue(frameStart.toString());
    }
  }, [frameStart]);

  // End frame input handlers
  const handleEndFocus = useCallback(() => {
    setEndInputValue(frameEnd.toString());
    setIsEditingEnd(true);
  }, [frameEnd]);

  const handleEndChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEndInputValue(e.target.value);
  }, []);

  const handleEndBlur = useCallback(() => {
    setIsEditingEnd(false);
    const value = parseInt(endInputValue, 10);
    if (!isNaN(value) && value > frameStart) {
      setFrameRange(frameStart, value);
    }
  }, [endInputValue, frameStart, setFrameRange]);

  const handleEndKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setIsEditingEnd(false);
      setEndInputValue(frameEnd.toString());
    }
  }, [frameEnd]);

  return (
<div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-50">
      {/* Timeline container - fixed width */}
      <div className="w-[600px] h-10 bg-zinc-800  backdrop-blur-sm rounded-md flex items-center shadow-lg border-t border-t-zinc-700 px-1">
        {/* Start frame pill - editable */}
        <div className="rounded-sm flex justify-center align-center py-[7px] text-zinc-300 hover:text-zinc-200 bg-zinc-700/50 hover:bg-zinc-600 ">
          <input
            type="text"
            inputMode="numeric"
            value={isEditingStart ? startInputValue : frameStart}
            onFocus={handleStartFocus}
            onChange={handleStartChange}
            onBlur={handleStartBlur}
            onKeyDown={handleStartKeyDown}
            className="max-w-12 text-xs  tabular-nums bg-transparent text-center focus:outline-none focus:text-white"
          />
        </div>

        {/* Timeline track */}
        <div
          ref={trackRef}
          className="flex-1 h-full relative cursor-pointer mx-[18px]"
          onMouseDown={handleMouseDown}
        >
          {/* Tick marks - UPDATED: Changed from 'bottom-0' to 'inset-0' to fill height */}
          <div className="absolute inset-0">
            {ticks().map(({ frame, isMajor, x }) => (
              <div
                key={frame}
                // UPDATED: Changed 'bottom-0' to 'top-1/2 -translate-y-1/2' for centering
                className="absolute top-1/2 -translate-y-1/2"
                style={{ left: `${x}px` }}
              >
                <div
                  className={`w-px ${isMajor ? 'h-3 bg-zinc-500' : 'h-1.5 bg-zinc-500/50'
                    }`}
                />
              </div>
            ))}
          </div>

          {/* Current frame playhead with fused frame number */}
          <div
            className="absolute top-1/2 group cursor-pointer"
            style={{ left: `${scrubberPercent}%`, transform: `translateX(-50%) translateY(-50%)` }}
          >
            <div
              className="
      px-2 py-1 min-w-[30px] min-h-[30px] bg-zinc-300 hover:bg-zinc-200 rounded-sm flex items-center justify-center border-t border-zinc-500 shadow-md
      
      /* Animation Classes */
      origin-bottom             
      transition-transform      
      duration-0             
      ease-out                  
      group-hover:scale-[1.0]   
    "
            >
              <span className="text-xs text-zinc-800 tabular-nums">
                {currentFrame}
              </span>
            </div>
          </div>
        </div>

        {/* End frame pill - editable */}
        <div className=" rounded-sm  flex justify-center align-center py-[7px] text-zinc-300 hover:text-zinc-200 bg-zinc-700/50 hover:bg-zinc-600 ">
          <input
            type="text"
            inputMode="numeric"
            value={isEditingEnd ? endInputValue : frameEnd}
            onFocus={handleEndFocus}
            onChange={handleEndChange}
            onBlur={handleEndBlur}
            onKeyDown={handleEndKeyDown}
            className="max-w-12 text-xs tabular-nums bg-transparent text-center focus:outline-none focus:text-white"
          />
        </div>
      </div>
    </div>
  );
}
