import { useLayoutEffect, type RefObject } from "react";

// Must match `grid-auto-rows` on `.wall` in index.css.
const ROW_PX = 4;
// Space left under each item, since the wall has no row gap.
const GAP_PX = 9;

/**
 * Masonry for the flyer wall. Each direct child of the grid spans as many
 * 4px rows as its own height needs, so sheets of different heights pack
 * without ragged rows. DOM order never changes, only visual placement.
 *
 * Spans update when an item resizes (content, fonts, viewport width) and
 * when items are added or removed (filters, load more, the Rec hours row).
 * Without ResizeObserver, as in jsdom, it does nothing.
 */
export function useMasonry(gridRef: RefObject<HTMLElement | null>) {
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
      const heights = items.map((item) => item.offsetHeight);
      items.forEach((item, index) => {
        const span = `span ${Math.ceil((heights[index] + GAP_PX) / ROW_PX)}`;
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
  }, [gridRef]);
}
