/**
 * Horizontal scroll for the two obsada timelines.
 *
 * Position is kept as a **day anchor** rather than a pixel offset, so
 * switching Miesiące → Dni keeps you looking at the same week instead of
 * throwing you back to the origin, and switching tabs keeps your place. Every
 * layout that changes the grid's width — mount, tab switch, unit switch —
 * lands in the same effect, so none of them needs its own path.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ObsadaAxis } from "./axis";

export const AXIS_H = 44;
export const BAND_H = 19;

export interface TimelineScroll {
  ref: React.RefObject<HTMLDivElement | null>;
  scrollLeft: number;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  goTo: (x: number) => void;
  goToday: () => void;
}

export function useTimelineScroll(
  anchorDayRef: React.MutableRefObject<number | null>,
  axis: ObsadaAxis,
): TimelineScroll {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anchor = anchorDayRef.current;
    el.scrollLeft = anchor == null ? Math.max(0, axis.todayX - 140) : Math.max(0, Math.round(anchor * axis.pxPerDay));
    setScrollLeft(el.scrollLeft);
    anchorDayRef.current = el.scrollLeft / axis.pxPerDay;
  }, [anchorDayRef, axis.pxPerDay, axis.gridW, axis.todayX]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const next = e.currentTarget.scrollLeft;
      anchorDayRef.current = next / axis.pxPerDay;
      // Coarse: the only thing re-rendering on scroll is the period label, and
      // a repaint per pixel to move a label by nothing is pure jank.
      setScrollLeft((prev) => (Math.abs(prev - next) > 16 ? next : prev));
    },
    [anchorDayRef, axis.pxPerDay],
  );

  const goTo = useCallback(
    (x: number) => {
      const el = ref.current;
      if (!el) return;
      el.scrollLeft = Math.max(0, x);
      anchorDayRef.current = el.scrollLeft / axis.pxPerDay;
      setScrollLeft(el.scrollLeft);
    },
    [anchorDayRef, axis.pxPerDay],
  );

  const goToday = useCallback(() => goTo(axis.todayX - 140), [goTo, axis.todayX]);

  return { ref, scrollLeft, onScroll, goTo, goToday };
}
