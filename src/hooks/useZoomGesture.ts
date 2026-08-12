import { useEffect, useRef, useState } from "react";
import { clampPpm, pinchZoomFactor } from "../components/timelineChrome";

export interface ZoomGesture {
  ppm: number;
  setPpm: (ppm: number) => void;
  /** Attach to the scrollable timeline container. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

// React registers onWheel as a passive listener, so preventDefault() inside a
// JSX handler is silently ignored (and warns) — a native listener is the only
// way to actually stop the browser's own pinch-to-zoom on the page.
export function useZoomGesture(initialPpm: number): ZoomGesture {
  const [ppm, setPpm] = useState(initialPpm);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      const factor = pinchZoomFactor(event);
      if (factor == null) return;
      event.preventDefault();
      setPpm((p) => clampPpm(p * factor));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return { ppm, setPpm, scrollRef };
}
