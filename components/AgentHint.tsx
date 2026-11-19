import { useState } from "react";

export const AGENT_HINT_DISMISSED_KEY = "cal-events:agent-hint-dismissed-v1";

// The same test registerWebMcpTools uses, so the line shows only where the
// site's WebMCP tools actually registered.
function browserRunsWebMcp(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.modelContext?.registerTool === "function"
    );
  } catch {
    return false;
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(AGENT_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One line under the search blank for visitors whose browser can run the
 * site's WebMCP tools. Others get nothing, so their layout never moves.
 */
export function AgentHint() {
  const [visible, setVisible] = useState(
    () => browserRunsWebMcp() && !readDismissed(),
  );

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(AGENT_HINT_DISMISSED_KEY, "1");
    } catch {
      /* storage blocked: the line stays hidden until the next load */
    }
  };

  return (
    <p className="hint">
      <span>
        Using an AI agent? It can find events for you and add them to your
        calendar. <a href="/for-agents.html">How agents use CalEvents</a>
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss AI agent tip">
        <span aria-hidden="true">×</span>
      </button>
    </p>
  );
}
