import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const publicDir = path.join(rootDir, "public");

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function sha256(relativePath) {
  return crypto
    .createHash("sha256")
    .update(readText(relativePath))
    .digest("hex");
}

test("agent-readable static files are present", () => {
  for (const relativePath of [
    "public/robots.txt",
    "public/sitemap.xml",
    "public/gtag-init.js",
    "public/webmcp-tools.js",
    "public/llms.txt",
    "public/llms-full.txt",
    "public/openapi.json",
    "public/.well-known/api-catalog",
    "public/.well-known/mcp/server-card.json",
    "public/.well-known/agent-card.json",
    "public/.well-known/agent-skills/index.json",
    "public/.well-known/security.txt",
    "public/favicon.svg",
    "public/favicon.ico",
    "public/apple-touch-icon.png",
    "public/about.html",
    "public/privacy.html",
    "public/404.html",
    "public/site-pages.css",
  ]) {
    assert.ok(fs.existsSync(path.join(rootDir, relativePath)), relativePath);
  }
});

// Expires is checked for format only. A date check here would start failing
// the daily data pull request once the file goes stale.
test("security.txt carries the RFC 9116 fields", () => {
  const securityTxt = readText("public/.well-known/security.txt");
  assert.match(securityTxt, /^Contact: mailto:\S+@\S+$/m);
  assert.match(securityTxt, /^Preferred-Languages: en$/m);
  assert.match(
    securityTxt,
    /^Canonical: https:\/\/cal-events\.com\/\.well-known\/security\.txt$/m,
  );
  const expires = securityTxt.match(/^Expires: (\S+)$/m)?.[1];
  assert.ok(expires, "Expires is required");
  assert.ok(!Number.isNaN(Date.parse(expires)), "Expires must be a date");
});

test("static pages cover about, privacy, and the 404", () => {
  const sitemap = readText("public/sitemap.xml");
  for (const page of ["about.html", "privacy.html", "for-agents.html"]) {
    assert.ok(sitemap.includes(`<loc>https://cal-events.com/${page}</loc>`));
    const html = readText(`public/${page}`);
    assert.match(html, /<h1>[^<]+<\/h1>/);
    assert.match(html, /href="\/site-pages\.css"/);
  }
  assert.match(
    readText("public/404.html"),
    /<meta name="robots" content="noindex" \/>/,
  );
  // The privacy page must name every analytics tool the site loads.
  const privacy = readText("public/privacy.html");
  for (const tool of ["Google Analytics", "PostHog", "Vercel Web Analytics"]) {
    assert.ok(privacy.includes(tool), tool);
  }
});

test("the home page shell reads without JavaScript", () => {
  const html = readText("index.html");
  const root = html.match(/<div id="root">([\s\S]*?)<script/)?.[1] ?? "";
  assert.match(root, /<main class="boot">/);
  assert.match(root, /<h1>[^<]+<\/h1>/);
  assert.match(root, /href="\/about\.html"/);
  assert.match(root, /href="\/privacy\.html"/);

  const jsonLd = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(jsonLd, "WebSite structured data");
  const data = JSON.parse(jsonLd);
  assert.equal(data["@type"], "WebSite");
  assert.equal(
    data.potentialAction.target.urlTemplate,
    "https://cal-events.com/?q={search_term_string}",
  );
});

test("robots.txt declares sitemap, AI bot rules, and content signals", () => {
  const robots = readText("public/robots.txt");
  for (const bot of [
    "GPTBot",
    "OAI-SearchBot",
    "Claude-Web",
    "Google-Extended",
    "Amazonbot",
    "anthropic-ai",
    "Bytespider",
    "CCBot",
    "Applebot-Extended",
  ]) {
    assert.match(robots, new RegExp(`User-agent: ${bot}`));
  }
  assert.match(robots, /Sitemap: https:\/\/cal-events\.com\/sitemap\.xml/);
  assert.match(robots, /Content-Signal: ai-train=no, search=yes, ai-input=yes/);
});

test("sitemap lists canonical agent resources", () => {
  const sitemap = readText("public/sitemap.xml");
  for (const url of [
    "https://cal-events.com/",
    "https://cal-events.com/for-agents.html",
    "https://cal-events.com/llms.txt",
    "https://cal-events.com/events.json",
    "https://cal-events.com/status.json",
  ]) {
    assert.match(sitemap, new RegExp(`<loc>${url}</loc>`));
  }
});

test("agent discovery JSON files are valid and internally linked", () => {
  const apiCatalog = readJson("public/.well-known/api-catalog");
  const serverCard = readJson("public/.well-known/mcp/server-card.json");
  const agentCard = readJson("public/.well-known/agent-card.json");
  const openapi = readJson("public/openapi.json");

  assert.ok(Array.isArray(apiCatalog.linkset));
  assert.equal(serverCard.serverInfo.name, "CalEvents");
  assert.ok(serverCard.capabilities.prompts["whats-on-tonight"]);
  assert.ok(serverCard.capabilities.prompts["is-feed-healthy"]);
  assert.ok(serverCard.capabilities.prompts["ics-for-event"]);
  assert.equal(agentCard.name, "CalEvents");
  assert.equal(agentCard.capabilities.readOnly, true);
  assert.match(openapi.info.description, /Read-only/i);
  assert.ok(
    Array.isArray(agentCard.supportedInterfaces),
    "A2A Agent Card must declare supportedInterfaces",
  );
  assert.ok(
    agentCard.supportedInterfaces.some(
      (supportedInterface) =>
        supportedInterface.url === "https://cal-events.com/" &&
        supportedInterface.transport === "webmcp" &&
        supportedInterface.protocolBinding,
    ),
    "A2A Agent Card must advertise the browser WebMCP interface",
  );
  assert.equal(openapi.openapi, "3.1.0");
  assert.ok(openapi.paths["/events.json"]);
  assert.ok(openapi.paths["/status.json"]);
  assert.equal(
    openapi.info.version,
    serverCard.serverInfo.version,
    "OpenAPI and MCP server-card versions must stay equal",
  );
  assert.equal(
    openapi.info.version,
    agentCard.version,
    "OpenAPI and agent-card versions must stay equal",
  );
  assert.equal(openapi.info.version, "1.6.0");
});

test("agent docs describe the multi-day date fields", () => {
  const openapi = readJson("public/openapi.json");
  const event = openapi.components.schemas.Event;
  assert.equal(event.properties.end_date?.format, "date");
  assert.equal(event.properties.dates?.type, "array");
  assert.ok(event.required.includes("source"), "source is always published");

  const llms = readText("public/llms.txt");
  const llmsFull = readText("public/llms-full.txt");
  const searchSkill = readText(
    "public/.well-known/agent-skills/search-events/SKILL.md",
  );
  for (const [name, text] of [
    ["llms.txt", llms],
    ["llms-full.txt", llmsFull],
    ["search-events skill", searchSkill],
  ]) {
    assert.match(text, /`end_date`/, `${name} must document end_date`);
    assert.match(text, /`dates`/, `${name} must document dates`);
  }
  assert.doesNotMatch(
    llmsFull,
    /Filter events by `date >= today`/,
    "date-only filtering drops multi-day events",
  );
});

test("agent URL and search guidance includes the topic filter", () => {
  const searchSkill = readText(
    "public/.well-known/agent-skills/search-events/SKILL.md",
  );
  const shareSkill = readText(
    "public/.well-known/agent-skills/share-event/SKILL.md",
  );
  const forAgents = readText("public/for-agents.html");
  const agentCard = readJson("public/.well-known/agent-card.json");
  const webMcpTools = readText("agent/webmcpTools.ts");
  const searchCapability = agentCard.skills.find(
    (skill) => skill.id === "search-events",
  );

  assert.match(
    searchSkill,
    /apply_ui_state[\s\S]*`q` \/ `date` \/ `category` \/ `topic` \/ `source`/,
  );
  assert.match(shareSkill, /\| `topic`\s+\|/);
  assert.match(shareSkill, /events\.json\.topic_vocabulary\.topics/);
  assert.match(forAgents, /<code>\?topic<\/code>/);
  assert.match(forAgents, /events\.json\.topic_vocabulary\.topics/);
  assert.match(searchCapability?.description ?? "", /topic/i);
  assert.match(
    searchCapability?.description ?? "",
    /events\.json\.topic_vocabulary\.topics/,
  );

  for (const pattern of [
    /name: "search_berkeley_events"[\s\S]{0,600}Optional category\/topic\/source\/date/,
    /name: "get_ui_state"[\s\S]{0,600}q\/date\/category\/topic\/source/,
    /name: "build_calevents_url"[\s\S]{0,600}q, date, category, topic, source, event/,
    /name: "apply_ui_state"[\s\S]{0,600}q\/date\/category\/topic\/source\/event/,
  ]) {
    assert.match(webMcpTools, pattern);
  }
});

test("OpenAPI and feed-health guidance expose topic assignment status", () => {
  const openapi = readJson("public/openapi.json");
  const serverCard = readJson("public/.well-known/mcp/server-card.json");
  const feedStatusSkill = readText(
    "public/.well-known/agent-skills/event-feed-status/SKILL.md",
  );
  const eventsSchema =
    openapi.paths["/events.json"].get.responses["200"].content[
      "application/json"
    ].schema;
  const statusSchema =
    openapi.paths["/status.json"].get.responses["200"].content[
      "application/json"
    ].schema;
  const topicStatus = openapi.components.schemas.TopicAssignmentStatus;
  const healthPrompt = serverCard.capabilities.prompts[
    "is-feed-healthy"
  ].messages
    .map((message) => message.content)
    .join("\n");
  const llmsFull = readText("public/llms-full.txt");

  assert.ok(eventsSchema.required.includes("topic_vocabulary"));
  assert.ok(statusSchema.required.includes("topics"));
  assert.equal(
    statusSchema.properties.topics.$ref,
    "#/components/schemas/TopicAssignmentStatus",
  );
  assert.deepEqual(topicStatus.properties.outcome.enum, ["ok", "error"]);
  for (const field of ["outcome", "assigned_count", "carried_forward_count"]) {
    assert.ok(topicStatus.required.includes(field));
  }
  assert.equal(topicStatus.required.includes("error"), false);

  for (const text of [feedStatusSkill, healthPrompt, llmsFull]) {
    assert.match(text, /topics\.outcome/);
    assert.match(text, /topics\.carried_forward_count/);
    assert.match(text, /source health/i);
  }

  assert.match(
    llmsFull,
    /"lastUpdated": 1777560000000,\s*"topic_vocabulary": \{/,
  );
});

test("agent skills index contains valid SHA-256 digests", () => {
  const index = readJson("public/.well-known/agent-skills/index.json");
  assert.equal(
    index.$schema,
    "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  );

  for (const skill of index.skills) {
    assert.equal(skill.type, "skill-md");
    assert.match(skill.digest, /^sha256:[a-f0-9]{64}$/);
    const relativePath = `public${skill.url}`;
    assert.equal(skill.digest, `sha256:${sha256(relativePath)}`);
  }
});

test("homepage and Vercel config expose discovery hooks", () => {
  const html = readText("index.html");
  const registerWebMcp = readText("agent/registerWebMcp.ts");
  const webMcpTools = readText("agent/webmcpTools.ts");
  const vercel = readJson("vercel.json");
  const publicFiles = fs.readdirSync(publicDir);
  const securityHeadersRoute = vercel.routes.find(
    (entry) => entry.src === "^/(.*)$",
  );

  assert.ok(publicFiles.includes("llms.txt"));
  assert.ok(publicFiles.includes("for-agents.html"));
  assert.match(html, /src="\/webmcp-tools\.js"/);
  assert.match(registerWebMcp, /registerWebMcpTools/);
  assert.match(webMcpTools, /search_berkeley_events/);
  assert.match(webMcpTools, /get_ui_state/);
  assert.match(webMcpTools, /apply_ui_state/);
  assert.match(webMcpTools, /build_calevents_url/);
  assert.match(webMcpTools, /get_event_directions/);
  assert.match(webMcpTools, /AbortController/);
  assert.match(webMcpTools, /input = input \?\? \{\}/);
  // The search tool runs the UI's ranked engine through agent/searchPlan.ts.
  assert.match(webMcpTools, /runAgentSearch\(/);
  assert.match(readText("agent/searchPlan.ts"), /searchEvents\(/);
  assert.equal(
    securityHeadersRoute.headers["X-Content-Type-Options"],
    "nosniff",
  );
  assert.equal(securityHeadersRoute.headers["X-Frame-Options"], "DENY");
  assert.match(
    securityHeadersRoute.headers["Content-Security-Policy"],
    /frame-ancestors 'none'/,
  );
  const scriptSrc =
    securityHeadersRoute.headers["Content-Security-Policy"].match(
      /script-src[^;]+/,
    )?.[0];
  assert.ok(scriptSrc);
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
  assert.match(
    securityHeadersRoute.headers["Content-Security-Policy"],
    /object-src 'none'/,
  );
  assert.ok(securityHeadersRoute.headers["Permissions-Policy"]);
  assert.equal(
    securityHeadersRoute.headers["Referrer-Policy"],
    "strict-origin-when-cross-origin",
  );

  const markdownRoute = vercel.routes.find(
    (entry) => entry.src === "^/$" && entry.dest === "/llms.txt",
  );
  assert.equal(
    markdownRoute.headers["Content-Type"],
    "text/markdown; charset=utf-8",
  );

  const homeHeaders = vercel.routes.find(
    (entry) => entry.src === "^/$" && entry.continue === true,
  );
  assert.ok(homeHeaders, "homepage Link headers must be configured");
  assert.match(JSON.stringify(homeHeaders), /api-catalog/);
  assert.match(JSON.stringify(homeHeaders), /llms\.txt/);

  const filesystemIndex = vercel.routes.findIndex(
    (entry) => entry.handle === "filesystem",
  );
  assert.ok(
    filesystemIndex >= 0,
    "Vercel filesystem route must still serve the app",
  );

  // The two root scripts are not content-hashed, so they get a short
  // lifetime rather than immutable.
  for (const src of ["^/gtag-init\\.js$", "^/webmcp-tools\\.js$"]) {
    const index = vercel.routes.findIndex((entry) => entry.src === src);
    assert.ok(index >= 0 && index < filesystemIndex, src);
    const route = vercel.routes[index];
    assert.equal(route.continue, true, src);
    assert.equal(
      route.headers["Cache-Control"],
      "public, max-age=3600, stale-while-revalidate=86400",
    );
  }
  const securityTxtRoute = vercel.routes.find(
    (entry) => entry.src === "^/\\.well-known/security\\.txt$",
  );
  assert.equal(
    securityTxtRoute?.headers["Content-Type"],
    "text/plain; charset=utf-8",
  );
});
