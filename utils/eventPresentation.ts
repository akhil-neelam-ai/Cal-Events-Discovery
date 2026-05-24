import { CalEvent } from "../types";

const ONLINE_LOCATION_RE =
  /\b(online|virtual|zoom|remote|livestream|live stream|webinar)\b/i;

export type CategoryStyle = {
  label: string;
  badge: string;
  border: string;
  accent: string;
  stripColor: string;
  tintBg: string;
};

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  Academic: {
    label: "Academic",
    badge: "bg-sky-100 text-sky-800",
    border: "border-l-sky-400",
    accent: "bg-sky-100 text-sky-800",
    stripColor: "#38bdf8",
    tintBg: "bg-sky-50/30",
  },
  Arts: {
    label: "Arts",
    badge: "bg-amber-100 text-amber-800",
    border: "border-l-amber-400",
    accent: "bg-amber-100 text-amber-900",
    stripColor: "#fbbf24",
    tintBg: "bg-amber-50/30",
  },
  Sports: {
    label: "Sports",
    badge: "bg-emerald-100 text-emerald-800",
    border: "border-l-emerald-400",
    accent: "bg-emerald-100 text-emerald-900",
    stripColor: "#34d399",
    tintBg: "bg-emerald-50/30",
  },
  "Science & Tech": {
    label: "Science & Tech",
    badge: "bg-indigo-100 text-indigo-800",
    border: "border-l-indigo-400",
    accent: "bg-indigo-100 text-indigo-900",
    stripColor: "#818cf8",
    tintBg: "bg-indigo-50/30",
  },
  "Student Life": {
    label: "Student Life",
    badge: "bg-rose-100 text-rose-800",
    border: "border-l-rose-400",
    accent: "bg-rose-100 text-rose-900",
    stripColor: "#fb7185",
    tintBg: "bg-rose-50/30",
  },
  Entrepreneurship: {
    label: "Entrepreneurship",
    badge: "bg-violet-100 text-violet-800",
    border: "border-l-violet-400",
    accent: "bg-violet-100 text-violet-900",
    stripColor: "#a78bfa",
    tintBg: "bg-violet-50/30",
  },
  Event: {
    label: "Event",
    badge: "bg-slate-100 text-slate-800",
    border: "border-l-slate-300",
    accent: "bg-slate-100 text-slate-800",
    stripColor: "#94a3b8",
    tintBg: "bg-slate-50/20",
  },
};

const BERKELEY_LOCATIONS = [
  "berkeley",
  "uc berkeley",
  "cal ",
  "memorial stadium",
  "haas pavilion",
  "edwards stadium",
  "evans diamond",
  "hearst",
  "recreational sports facility",
  "rsf",
  "zellerbach",
  "wheeler",
  "dwinelle",
  "soda hall",
  "cory hall",
  "doe library",
  "moffitt",
  "bancroft",
  "sproul",
  "mlk student union",
  "california memorial",
  "greek theatre",
  "hearst greek",
];

export function getDirectionsUrl(location: string): string | null {
  if (!location || ONLINE_LOCATION_RE.test(location)) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

export function getCategoryStyle(tag?: string): CategoryStyle {
  if (!tag) {
    return CATEGORY_STYLES.Event;
  }

  const normalized = tag.toLowerCase();
  if (normalized.includes("art")) return CATEGORY_STYLES.Arts;
  if (normalized.includes("sport")) return CATEGORY_STYLES.Sports;
  if (normalized.includes("science") || normalized.includes("tech"))
    return CATEGORY_STYLES["Science & Tech"];
  if (normalized.includes("student")) return CATEGORY_STYLES["Student Life"];
  if (normalized.includes("entrepreneur"))
    return CATEGORY_STYLES.Entrepreneurship;
  if (normalized.includes("academic")) return CATEGORY_STYLES.Academic;

  return CATEGORY_STYLES[tag] || CATEGORY_STYLES.Event;
}

export function isHomeGame(event: CalEvent): boolean {
  const isSportsEvent = event.tags?.some((tag) =>
    tag.toLowerCase().includes("sport"),
  );
  if (!isSportsEvent) {
    return true;
  }

  const location = event.location.toLowerCase();
  return BERKELEY_LOCATIONS.some((value) => location.includes(value));
}
