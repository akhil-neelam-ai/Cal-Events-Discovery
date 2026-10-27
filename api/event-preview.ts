/**
 * Open Graph page for a shared event link. vercel.json routes `/?event=<id>`
 * here only for link-preview crawlers; people still get the app.
 */
import {
  buildDefaultPreview,
  buildEventPreview,
  findPublishedEvent,
  renderPreviewHtml,
} from "./_lib/eventPreview.js";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("event")?.trim() ?? "";

  let preview = buildDefaultPreview(url.origin);
  try {
    const event = await findPublishedEvent(id);
    if (event) {
      preview = buildEventPreview(event, url.origin);
    }
  } catch (error) {
    // A missing or unreadable feed still gets the site-wide preview.
    console.error("[event-preview] could not read events.json", error);
  }

  return new Response(renderPreviewHtml(preview), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}

export async function HEAD(request: Request): Promise<Response> {
  const response = await GET(request);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
