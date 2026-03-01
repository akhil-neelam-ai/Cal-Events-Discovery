"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchReplies, updateReplyStatus } from "@/lib/api";
import { Reply, ReplyUrgency, ReplyStatus } from "@/lib/types";
import { formatDate, getUrgencyConfig, cn } from "@/lib/utils";

function ReplyCard({
  reply,
  onAction,
}: {
  reply: Reply;
  onAction: (replyId: string, action: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const urgency = getUrgencyConfig(reply.urgency);

  return (
    <div className={cn("border rounded-xl p-5 transition-shadow hover:shadow-md", urgency.bgClassName)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{urgency.icon}</span>
            <Link
              href={`/companies/${reply.companyId}`}
              className="font-semibold text-gray-900 hover:text-green-700"
            >
              {reply.companyName}
            </Link>
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", urgency.className,
              reply.urgency === "hot" ? "bg-red-100" :
              reply.urgency === "warm" ? "bg-amber-100" : "bg-blue-100"
            )}>
              {urgency.label}
            </span>
            {reply.status === "new" && (
              <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0" title="New" />
            )}
          </div>
          <p className="text-sm font-medium text-gray-700">{reply.contactName}</p>
          <p className="text-xs text-gray-500">{reply.subject}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-gray-400">{formatDate(reply.receivedAt)}</p>
          {reply.status === "snoozed" && reply.snoozeUntil && (
            <p className="text-xs text-amber-600 mt-0.5">Snoozed until {formatDate(reply.snoozeUntil)}</p>
          )}
        </div>
      </div>

      {/* Suggested Action */}
      <div className="bg-white/60 rounded-lg p-3 mb-3">
        <p className="text-xs text-gray-500 mb-1">Suggested Action</p>
        <p className="text-sm text-gray-700">{reply.suggestedAction}</p>
      </div>

      {/* Email body (collapsible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-500 hover:text-gray-700 mb-3 flex items-center gap-1"
      >
        <svg
          className={cn("w-3 h-3 transition-transform", expanded && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {expanded ? "Hide" : "Show"} full email
      </button>
      {expanded && (
        <div className="bg-white rounded-lg p-4 mb-3 text-sm text-gray-700 whitespace-pre-line border border-gray-100">
          {reply.body}
        </div>
      )}

      {/* One-click Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-200/50">
        {reply.status !== "done" && (
          <>
            <button
              onClick={() => onAction(reply.id, "draft")}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Draft Response
            </button>
            <button
              onClick={() => onAction(reply.id, "done")}
              className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium rounded-lg border border-gray-200 transition-colors"
            >
              Mark Done
            </button>
            {reply.status !== "snoozed" && (
              <button
                onClick={() => onAction(reply.id, "snooze")}
                className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium rounded-lg border border-gray-200 transition-colors"
              >
                Snooze 3d
              </button>
            )}
          </>
        )}
        {reply.status === "done" && (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Completed
          </span>
        )}
        <Link
          href={`/companies/${reply.companyId}`}
          className="ml-auto text-xs text-green-600 hover:text-green-700 font-medium"
        >
          View Company →
        </Link>
      </div>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="h-8 skeleton w-48" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 skeleton rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function RepliesPage() {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | ReplyUrgency>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ReplyStatus>("all");

  useEffect(() => {
    async function load() {
      const data = await fetchReplies();
      setReplies(data);
      setLoading(false);
    }
    load();
  }, []);

  const handleAction = async (replyId: string, action: string) => {
    if (action === "done") {
      await updateReplyStatus(replyId, "done");
      setReplies((prev) =>
        prev.map((r) => (r.id === replyId ? { ...r, status: "done" as ReplyStatus } : r))
      );
    } else if (action === "snooze") {
      const snoozeDate = new Date();
      snoozeDate.setDate(snoozeDate.getDate() + 3);
      await updateReplyStatus(replyId, "snoozed", snoozeDate.toISOString());
      setReplies((prev) =>
        prev.map((r) =>
          r.id === replyId
            ? { ...r, status: "snoozed" as ReplyStatus, snoozeUntil: snoozeDate.toISOString() }
            : r
        )
      );
    } else if (action === "draft") {
      // In production, this would open a draft editor
      setReplies((prev) =>
        prev.map((r) => (r.id === replyId ? { ...r, status: "in_progress" as ReplyStatus } : r))
      );
    }
  };

  if (loading) return <SkeletonLoader />;

  const filtered = replies.filter((r) => {
    const matchesUrgency = filter === "all" || r.urgency === filter;
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    return matchesUrgency && matchesStatus;
  });

  // Group by urgency
  const hot = filtered.filter((r) => r.urgency === "hot");
  const warm = filtered.filter((r) => r.urgency === "warm");
  const cold = filtered.filter((r) => r.urgency === "cold");

  const newCount = replies.filter((r) => r.status === "new").length;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Replies</h1>
          <p className="text-sm text-gray-500 mt-1">
            {replies.length} total replies
            {newCount > 0 && <span className="text-red-600 font-medium"> · {newCount} new</span>}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1.5">
          {(["all", "hot", "warm", "cold"] as const).map((u) => {
            const config = u === "all" ? null : getUrgencyConfig(u);
            const count = u === "all" ? replies.length : replies.filter((r) => r.urgency === u).length;
            return (
              <button
                key={u}
                onClick={() => setFilter(u)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                  filter === u
                    ? "bg-green-600 text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                {config ? `${config.icon} ${config.label}` : "All"} ({count})
              </button>
            );
          })}
        </div>
        <div className="border-l border-gray-200 mx-1" />
        <div className="flex gap-1.5">
          {(["all", "new", "in_progress", "snoozed", "done"] as const).map((s) => {
            const labels: Record<string, string> = { all: "All", new: "New", in_progress: "In Progress", snoozed: "Snoozed", done: "Done" };
            const count = s === "all" ? replies.length : replies.filter((r) => r.status === s).length;
            if (count === 0 && s !== "all") return null;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                  statusFilter === s
                    ? "bg-green-600 text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                {labels[s]} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Reply Groups */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No replies match your filters.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Hot replies */}
          {hot.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-red-700 mb-3">
                <span>🔥</span> Hot - Needs Immediate Attention ({hot.length})
              </h2>
              <div className="space-y-3">
                {hot.map((reply) => (
                  <ReplyCard key={reply.id} reply={reply} onAction={handleAction} />
                ))}
              </div>
            </div>
          )}

          {/* Warm replies */}
          {warm.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-700 mb-3">
                <span>☀️</span> Warm - Follow Up ({warm.length})
              </h2>
              <div className="space-y-3">
                {warm.map((reply) => (
                  <ReplyCard key={reply.id} reply={reply} onAction={handleAction} />
                ))}
              </div>
            </div>
          )}

          {/* Cold replies */}
          {cold.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-blue-700 mb-3">
                <span>❄️</span> Cold - Low Priority ({cold.length})
              </h2>
              <div className="space-y-3">
                {cold.map((reply) => (
                  <ReplyCard key={reply.id} reply={reply} onAction={handleAction} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
