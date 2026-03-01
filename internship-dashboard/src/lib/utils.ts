import { ContactConfidence, PipelineStage, ReplyUrgency, TimelineEventType } from "./types";

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getConfidenceBadge(confidence: ContactConfidence): {
  label: string;
  className: string;
  icon: string;
} {
  switch (confidence) {
    case "verified":
      return { label: "Verified", className: "bg-green-100 text-green-800", icon: "✓" };
    case "guessed":
      return { label: "Guessed", className: "bg-yellow-100 text-yellow-800", icon: "?" };
    case "unknown":
      return { label: "Unknown", className: "bg-red-100 text-red-800", icon: "!" };
  }
}

export function getDraftConfidenceColor(confidence: number): string {
  if (confidence >= 80) return "text-green-600";
  if (confidence >= 60) return "text-yellow-600";
  return "text-red-600";
}

export function getDraftConfidenceLabel(confidence: number): string {
  if (confidence >= 80) return "High confidence";
  if (confidence >= 60) return "Medium confidence";
  return "Low confidence - review recommended";
}

export function getUrgencyConfig(urgency: ReplyUrgency): {
  label: string;
  className: string;
  bgClassName: string;
  icon: string;
} {
  switch (urgency) {
    case "hot":
      return {
        label: "Hot",
        className: "text-red-700",
        bgClassName: "bg-red-50 border-red-200",
        icon: "🔥",
      };
    case "warm":
      return {
        label: "Warm",
        className: "text-amber-700",
        bgClassName: "bg-amber-50 border-amber-200",
        icon: "☀️",
      };
    case "cold":
      return {
        label: "Cold",
        className: "text-blue-700",
        bgClassName: "bg-blue-50 border-blue-200",
        icon: "❄️",
      };
  }
}

export function getTimelineIcon(type: TimelineEventType): string {
  switch (type) {
    case "discovered":
      return "🔍";
    case "researched":
      return "📊";
    case "outreach_drafted":
      return "✏️";
    case "outreach_sent":
      return "📧";
    case "follow_up_sent":
      return "📨";
    case "reply_received":
      return "💬";
    case "interview_scheduled":
      return "📅";
    case "note_added":
      return "📝";
    case "status_changed":
      return "🔄";
  }
}

export function getTimelineColor(type: TimelineEventType): string {
  switch (type) {
    case "discovered":
      return "bg-slate-400";
    case "researched":
      return "bg-blue-400";
    case "outreach_drafted":
      return "bg-indigo-400";
    case "outreach_sent":
      return "bg-amber-400";
    case "follow_up_sent":
      return "bg-orange-400";
    case "reply_received":
      return "bg-emerald-400";
    case "interview_scheduled":
      return "bg-green-500";
    case "note_added":
      return "bg-gray-400";
    case "status_changed":
      return "bg-purple-400";
  }
}

export function getStageLabel(stage: PipelineStage): string {
  const labels: Record<PipelineStage, string> = {
    discovered: "Discovered",
    researched: "Researched",
    outreach_sent: "Outreach Sent",
    followed_up: "Followed Up",
    replied: "Replied",
    interview: "Interview",
    done: "Done",
  };
  return labels[stage];
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
