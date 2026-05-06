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
    "public/llms.txt",
    "public/llms-full.txt",
    "public/openapi.json",
    "public/.well-known/api-catalog",
    "public/.well-known/mcp/server-card.json",
    "public/.well-known/agent-card.json",
    "public/.well-known/agent-skills/index.json",
  ]) {
    assert.ok(fs.existsSync(path.join(rootDir, relativePath)), relativePath);
  }
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
  assert.equal(agentCard.name, "CalEvents");
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
  const vercel = readJson("vercel.json");
  const publicFiles = fs.readdirSync(publicDir);
  const securityHeadersRoute = vercel.routes.find(
    (entry) => entry.src === "^/(.*)$",
  );

  assert.ok(publicFiles.includes("llms.txt"));
  assert.match(html, /navigator\.modelContext\.registerTool/);
  assert.match(html, /search_berkeley_events/);
  assert.equal(
    securityHeadersRoute.headers["X-Content-Type-Options"],
    "nosniff",
  );
  assert.equal(securityHeadersRoute.headers["X-Frame-Options"], "DENY");
  assert.match(
    securityHeadersRoute.headers["Content-Security-Policy"],
    /frame-ancestors 'none'/,
  );
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

  const filesystemRoute = vercel.routes.find(
    (entry) => entry.handle === "filesystem",
  );
  assert.ok(
    filesystemRoute,
    "Vercel filesystem route must still serve the app",
  );
});
