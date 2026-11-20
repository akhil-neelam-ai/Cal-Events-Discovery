/**
 * The 1200x630 card that api/event-preview.ts names as og:image for a shared
 * event link. It draws the event as its flyer on the wall: a sheet of the
 * category's paper on Berkeley blue, in Archivo, like the app. An unknown id
 * redirects to the site-wide image.
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

const WALL = "#003262";
const TONER = "#121212";

/**
 * Bundled with the function through `includeFiles` in vercel.json. Satori
 * cannot read a variable font, so each width and weight the card uses is a
 * static Archivo instance under its own family name.
 */
const FONTS_DIR = path.join(process.cwd(), "api", "_fonts");
const FONT_FILES = [
  { name: "Archivo XCond", weight: 900, file: "archivo-62-900.woff" },
  { name: "Archivo Cond", weight: 800, file: "archivo-75-800.woff" },
  { name: "Archivo Semi", weight: 700, file: "archivo-87-700.woff" },
  { name: "Archivo", weight: 500, file: "archivo-100-500.woff" },
  { name: "Archivo Wide", weight: 900, file: "archivo-112-900.woff" },
] as const;

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

/** Short titles print big and long ones shrink, as on the wall. */
function titleFontSize(title: string): number {
  if (title.length <= 28) return 104;
  if (title.length <= 50) return 88;
  if (title.length <= 80) return 72;
  return 60;
}

function footLine(card: EventCard): string {
  const organizer = truncate(card.organizer, 48);
  const filed = card.category ? `Filed under ${card.category}.` : "";
  if (!organizer) return filed;
  return `${organizer.replace(/\.$/, "")}. ${filed}`
    .replace(/\s+/g, " ")
    .trim();
}

function EventCardImage({ card }: { card: EventCard }) {
  const title = truncate(card.title, 110);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: WALL,
        fontFamily: "Archivo",
      }}
    >
      {/* The flyer, a little askew, with its staple */}
      <div
        style={{
          position: "absolute",
          left: 56,
          top: 44,
          width: 836,
          height: 542,
          display: "flex",
          flexDirection: "column",
          padding: "52px 56px 44px",
          backgroundColor: card.paper,
          color: TONER,
          transform: "rotate(-0.6deg)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 404,
            width: 30,
            height: 4,
            backgroundColor: "#2b2b2b",
            opacity: 0.6,
          }}
        />
        <div
          style={{
            display: "flex",
            fontFamily: "Archivo XCond",
            fontWeight: 900,
            fontSize: 46,
            lineHeight: 1,
          }}
        >
          {card.when.replace(/ · /g, ", ")}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontFamily: "Archivo Cond",
            fontWeight: 800,
            fontSize: titleFontSize(title),
            lineHeight: 1.02,
            letterSpacing: -0.5,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", flexGrow: 1 }} />
        {card.location ? (
          <div
            style={{
              display: "flex",
              fontFamily: "Archivo Semi",
              fontWeight: 700,
              fontSize: 34,
              lineHeight: 1.1,
            }}
          >
            {truncate(card.location, 55)}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            marginTop: 8,
            fontSize: 26,
            lineHeight: 1.2,
          }}
        >
          {footLine(card)}
        </div>
      </div>

      {/* Chalk on the wall: the wordmark and the address */}
      <div
        style={{
          position: "absolute",
          top: 50,
          right: 44,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          fontFamily: "Archivo Wide",
          fontWeight: 900,
          fontSize: 60,
          lineHeight: 0.92,
          color: "white",
        }}
      >
        <span>Cal</span>
        <span>Events</span>
      </div>
      <div
        style={{
          position: "absolute",
          right: 44,
          bottom: 52,
          display: "flex",
          paddingBottom: 4,
          borderBottom: "3px solid white",
          fontFamily: "Archivo Semi",
          fontWeight: 700,
          fontSize: 26,
          color: "white",
        }}
      >
        cal-events.com
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
