import {
  createDefaultFetchJson,
  createWebMcpTools,
  type WebMcpTool,
} from "./webmcpTools";

declare global {
  interface Navigator {
    modelContext?: {
      registerTool: (tool: WebMcpTool) => void;
    };
  }
}

function applyUrlSearch(search: string): void {
  const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) {
    return;
  }

  window.history.pushState(null, "", nextUrl);
  // useUrlStateSync listens for popstate; pushState alone does not fire it.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Register CalEvents WebMCP tools when navigator.modelContext is available. */
export function registerWebMcpTools(): void {
  try {
    if (
      !("modelContext" in navigator) ||
      !navigator.modelContext ||
      typeof navigator.modelContext.registerTool !== "function"
    ) {
      return;
    }

    const tools = createWebMcpTools({
      fetchJson: createDefaultFetchJson(),
      getLocationSearch: () => window.location.search,
      getOrigin: () => window.location.origin,
      applyUrlSearch,
    });

    for (const tool of tools) {
      navigator.modelContext.registerTool(tool);
    }
  } catch (error) {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      console.warn("[webmcp] tool registration failed", error);
    }
  }
}
