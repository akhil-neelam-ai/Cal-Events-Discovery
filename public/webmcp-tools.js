/**
 * Legacy entry for agent discovery probes.
 * WebMCP tools now register from the Vite app bundle via agent/registerWebMcp.ts
 * (same ranked search engine as the UI, plus URL workspace tools).
 *
 * Kept so /webmcp-tools.js remains a stable public URL. Registration happens
 * when the homepage module loads and navigator.modelContext is available.
 */
(function calEventsWebMcpLegacyStub() {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    console.info(
      "[webmcp] tools register from the app bundle (agent/registerWebMcp.ts)",
    );
  }
})();
