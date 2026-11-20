import { useLayoutEffect, type RefObject } from "react";

// Must match `grid-auto-rows` on `.wall` in index.css.
const ROW_PX = 4;
// Space left under each item, since the wall has no row gap.
const GAP_PX = 9;

function rowSpan(height: number): number {
  return Math.ceil((height + GAP_PX) / ROW_PX);
}

/**
 * Masonry for the flyer wall. Each direct child of the grid spans as many
 * 4px rows as its own height needs, so sheets of different heights pack
 * without ragged rows. DOM order never changes, only visual placement.
 *
 * On wide screens the `anchor` (the notice) sits beside a column of
 * `beside` items: filters, the view heading, notes, and the first day
 * strip. When that column runs taller than the anchor, the anchor's grid
 * area stretches to match. Otherwise sheets would fill in under the anchor
 * before the heading and strip that name them.
 *
 * Spans update when an item resizes (content, fonts, viewport width) and
 * when items are added or removed (filters, load more, the Rec hours row).
 * Without ResizeObserver, as in jsdom, it does nothing.
 */
export function useMasonry(
  gridRef: RefObject<HTMLElement | null>,
  { anchor, beside }: { anchor: string; beside: string },
) {
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (
      !grid ||
      typeof ResizeObserver === "undefined" ||
      typeof MutationObserver === "undefined"
    ) {
      return;
    }

    const layout = () => {
      const items = Array.from(grid.children) as HTMLElement[];
      // Read every height first, then write, so the browser lays out once.
      const spans = items.map((item) => rowSpan(item.offsetHeight));

      const anchorIndex = items.findIndex((item) => item.matches(anchor));
      const anchorItem = items[anchorIndex];
      if (anchorItem && anchorItem.offsetWidth < grid.clientWidth - 1) {
        const besideRows = items.reduce(
          (total, item, index) =>
            item.matches(beside) ? total + spans[index] : total,
          0,
        );
        spans[anchorIndex] = Math.max(spans[anchorIndex], besideRows);
      }

      items.forEach((item, index) => {
        const span = `span ${spans[index]}`;
        if (item.style.gridRowEnd !== span) item.style.gridRowEnd = span;
      });
    };

    const resizeObserver = new ResizeObserver(layout);
    const observeChildren = () => {
      resizeObserver.disconnect();
      for (const child of Array.from(grid.children)) {
        resizeObserver.observe(child);
      }
    };
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      layout();
    });

    layout();
    observeChildren();
    mutationObserver.observe(grid, { childList: true });

    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) layout();
    });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [anchor, beside, gridRef]);
}
