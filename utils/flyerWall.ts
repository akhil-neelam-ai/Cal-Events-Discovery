import type { CalEvent } from "../types";
import { clockMinutes } from "./eventDates";
import { isHomeGame } from "./eventPresentation";

// Each category prints on its own paper color (index.css). Anything else
// prints on plain paper.
const PAPER_SLUGS: Record<string, string> = {
  Academic: "academic",
  Arts: "arts",
  Sports: "sports",
  "Science & Tech": "scitech",
  "Student Life": "life",
  Entrepreneurship: "entre",
};

/** The CSS color for a category's paper. `tags[0]` is the category. */
export function paperColor(category?: string): string {
  const slug = (category && PAPER_SLUGS[category]) || "other";
  return `var(--color-paper-${slug})`;
}

/** The category a flyer is filed under. */
export function categoryLabel(category?: string): string {
  return category && PAPER_SLUGS[category] ? category : "Event";
}

/**
 * Copy on the wall separates its parts with commas. Shared labels such as
 * "Today · Nov 19" keep their middle dot for other callers and tests, so
 * the wall swaps it at render time.
 */
export function wallText(label: string): string {
  return label.replace(/ · /g, ", ");
}

/** Title size on a sheet: short titles print big, long ones condense. */
export function titleSizeClass(title: string): "s1" | "s2" | "s3" | "s4" {
  const length = title.length;
  if (length <= 16) return "s1";
  if (length <= 34) return "s2";
  if (length <= 62) return "s3";
  return "s4";
}

/**
 * A small tilt in degrees, from -0.8 to 0.8, fixed by the event id so a
 * sheet keeps its angle across filters and renders.
 */
export function sheetTilt(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return ((Math.abs(hash) % 9) - 4) * 0.2;
}

const BIG_ROOMS =
  /zellerbach|greek theatre|memorial stadium|haas pavilion|bampfa/i;

/**
 * Evening home games and evenings in the big rooms get a sheet two
 * columns wide.
 */
export function isWideSheet(event: CalEvent): boolean {
  const start = clockMinutes(event.time);
  if (start === null || start < 17 * 60) return false;
  const isSports = (event.tags ?? []).some((tag) =>
    tag.toLowerCase().includes("sport"),
  );
  return (isSports && isHomeGame(event)) || BIG_ROOMS.test(event.location);
}
