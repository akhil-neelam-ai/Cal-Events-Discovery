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
 * One line under the search box for visitors whose browser can run the
 * site's WebMCP tools. Others get nothing, so their layout never moves.
 */
export function AgentHint({ variant }: { variant: "desktop" | "mobile" }) {
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

  const isDesktop = variant === "desktop";

  return (
    <p
      className={
        isDesktop
          ? "mt-3 flex items-center justify-center gap-1 text-[13px] leading-5 text-white/72"
          : "-mt-1 flex items-center gap-1 text-xs leading-5 text-white/72"
      }
    >
      <span>
        Using an AI agent? It can find events for you and add them to your
        calendar.{" "}
        <a
          href="/for-agents.html"
          className="font-medium text-berkeley-gold underline underline-offset-2 hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold"
        >
          How agents use CalEvents
        </a>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss AI agent tip"
        className={`flex shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold ${
          isDesktop ? "h-7 w-7" : "-my-2 h-9 w-9"
        }`}
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </p>
  );
}
