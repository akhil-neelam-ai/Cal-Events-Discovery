import { useEffect, useId, useRef, useState } from "react";

import { AGENT_PROMPT } from "../appConfig";
import { trackAgentPrompt } from "../utils/analytics";

// New key, so people who dismissed the old WebMCP tip see this card once.
export const AGENT_PROMPT_DISMISSED_KEY =
  "cal-events:agent-prompt-dismissed-v1";

const COPIED_LABEL = "Copied. Paste it into your agent.";
const COPIED_MS = 4000;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(AGENT_PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A small card in the notice that hands visitors a prompt for their own AI
 * assistant. It copies the prompt, or shows it to copy by hand.
 */
export function AgentPromptCard() {
  const [visible, setVisible] = useState(() => !readDismissed());
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const selectOnOpenRef = useRef(false);
  const resetRef = useRef<number | null>(null);
  const promptId = useId();

  useEffect(() => {
    return () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    };
  }, []);

  // A refused copy opens the prompt, then selects it for copying by hand.
  useEffect(() => {
    if (open && selectOnOpenRef.current && promptRef.current) {
      selectOnOpenRef.current = false;
      promptRef.current.focus();
      promptRef.current.select();
    }
  }, [open]);

  if (!visible) return null;

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(AGENT_PROMPT);
      setStatus("copied");
      trackAgentPrompt("copy");
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
      resetRef.current = window.setTimeout(() => {
        setStatus("idle");
        resetRef.current = null;
      }, COPIED_MS);
    } catch {
      setStatus("failed");
      trackAgentPrompt("copy_failed");
      if (open && promptRef.current) {
        promptRef.current.focus();
        promptRef.current.select();
      } else {
        selectOnOpenRef.current = true;
        setOpen(true);
      }
    }
  };

  const toggle = () => {
    if (!open) trackAgentPrompt("show_prompt");
    setOpen((value) => !value);
  };

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(AGENT_PROMPT_DISMISSED_KEY, "1");
    } catch {
      /* storage blocked: the card stays hidden until the next load */
    }
  };

  return (
    <div className="agent-card">
      <p className="agent-card-text">
        Have an AI agent? Copy a prompt and let it find events you&apos;d like.
      </p>
      <div className="agent-card-actions">
        <button type="button" className="btn-line" onClick={() => void copy()}>
          {status === "copied" ? COPIED_LABEL : "Copy prompt"}
        </button>
        <button
          type="button"
          className="btn-line"
          aria-expanded={open}
          aria-controls={promptId}
          onClick={toggle}
        >
          See the prompt
        </button>
      </div>
      <p role="status" className="sr-only">
        {status === "copied"
          ? COPIED_LABEL
          : status === "failed"
            ? "Copying did not work. The prompt is selected below, ready to copy."
            : ""}
      </p>
      {open && (
        <div id={promptId} className="agent-card-prompt">
          <textarea
            ref={promptRef}
            readOnly
            aria-label="Prompt for your AI agent"
            value={AGENT_PROMPT}
            rows={12}
          />
          <a href="/for-agents.html">How agents use CalEvents</a>
        </div>
      )}
      <button
        type="button"
        className="agent-card-x"
        aria-label="Hide the agent prompt"
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
