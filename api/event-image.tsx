/**
 * The 1200x630 card that api/event-preview.ts names as og:image for a shared
 * event link. An unknown id redirects to the site-wide image.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "@vercel/og";

import {
  buildEventCard,
  findPublishedEvent,
  truncate,
  type EventCard,
} from "./_lib/eventPreview.js";

const BERKELEY_BLUE = "#003262";
const BERKELEY_GOLD = "#FDB515";

/** Bundled with the function through `includeFiles` in vercel.json. */
const FONTS_DIR = path.join(process.cwd(), "api", "_fonts");
const FONT_FILES = [
  { name: "Inter", weight: 500, file: "inter-latin-500-normal.woff" },
  { name: "Inter", weight: 700, file: "inter-latin-700-normal.woff" },
  {
    name: "Source Serif 4",
    weight: 600,
    file: "source-serif-4-latin-600-normal.woff",
  },
] as const;

// Icon paths match the date and location icons in EventDetailOverlay.
const CALENDAR_ICON =
  "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z";
const PIN_ICON =
  "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z";

let fonts: ReturnType<typeof readFonts> | null = null;

function readFonts() {
  return Promise.all(
    FONT_FILES.map(async ({ name, weight, file }) => ({
      name,
      weight,
      style: "normal" as const,
      data: await readFile(path.join(FONTS_DIR, file)),
    })),
  );
}

function loadFonts() {
  fonts ??= readFonts().catch((error: unknown) => {
    fonts = null;
    throw error;
  });
  return fonts;
}

function titleFontSize(title: string): number {
  if (title.length <= 40) return 76;
  if (title.length <= 70) return 64;
  if (title.length <= 100) return 54;
  return 46;
}

function DetailRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke={BERKELEY_GOLD}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icon} />
      </svg>
      <span>{text}</span>
    </div>
  );
}

function EventCardImage({ card }: { card: EventCard }) {
  const title = truncate(card.title, 115);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "56px 72px 48px 88px",
        backgroundColor: BERKELEY_BLUE,
        backgroundImage: "linear-gradient(135deg, #003262 0%, #001a33 100%)",
        color: "white",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 16,
          height: 630,
          backgroundColor: card.accent,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
          <span style={{ color: BERKELEY_GOLD }}>Cal</span>
          <span>Events</span>
        </div>
        <div
          style={{
            display: "flex",
            padding: "10px 24px",
            borderRadius: 999,
            backgroundColor: card.accent,
            color: BERKELEY_BLUE,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          {card.category}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          alignItems: "center",
          fontFamily: "Source Serif 4",
          fontWeight: 600,
          fontSize: titleFontSize(title),
          lineHeight: 1.15,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          fontSize: 32,
          fontWeight: 500,
        }}
      >
        <DetailRow icon={CALENDAR_ICON} text={card.when} />
        {card.location ? (
          <DetailRow icon={PIN_ICON} text={truncate(card.location, 60)} />
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 28,
          paddingTop: 22,
          borderTop: "2px solid rgba(255, 255, 255, 0.15)",
          fontSize: 24,
          color: "rgba(255, 255, 255, 0.7)",
        }}
      >
        <span>{truncate(card.organizer, 60)}</span>
        <span>cal-events.com</span>
      </div>
    </div>
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("event")?.trim() ?? "";

  let event;
  try {
    event = await findPublishedEvent(id);
  } catch (error) {
    console.error("[event-image] could not read events.json", error);
  }
  if (!event) {
    return Response.redirect(new URL("/og-image.png", url.origin), 302);
  }

  return new ImageResponse(<EventCardImage card={buildEventCard(event)} />, {
    width: 1200,
    height: 630,
    fonts: await loadFonts(),
    // Lowercase replaces the library's year-long immutable default.
    headers: { "cache-control": "public, max-age=3600, s-maxage=86400" },
  });
}

export async function HEAD(request: Request): Promise<Response> {
  const response = await GET(request);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
