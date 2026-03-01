"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPipelineStats, fetchActivityFeed, fetchCompanies } from "@/lib/api";
import { PipelineStats, ActivityItem, Company } from "@/lib/types";
import { PIPELINE_STAGES } from "@/lib/types";
import { formatDate, cn } from "@/lib/utils";

function StatCard({ label, value, color, href }: { label: string; value: number; color: string; href?: string }) {
  const content = (
    <div className={cn("bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow", href && "cursor-pointer")}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={cn("text-3xl font-bold mt-1", color)}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function ActionItemCard({ company }: { company: Company }) {
  if (!company.nextAction) return null;
  const { nextAction } = company;

  const priorityStyles = {
    high: "border-l-red-500 bg-red-50/50",
    medium: "border-l-amber-500 bg-amber-50/50",
    low: "border-l-gray-300 bg-gray-50/50",
  };

  const ctaStyles = {
    high: "bg-red-600 hover:bg-red-700 text-white",
    medium: "bg-amber-600 hover:bg-amber-700 text-white",
    low: "bg-gray-600 hover:bg-gray-700 text-white",
  };

  return (
    <div className={cn("border-l-4 rounded-lg p-4 border border-gray-200", priorityStyles[nextAction.priority])}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/companies/${company.id}`} className="font-semibold text-gray-900 hover:text-green-700 truncate">
              {company.name}
            </Link>
            {nextAction.priority === "high" && (
              <span className="flex-shrink-0 text-xs font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">URGENT</span>
            )}
          </div>
          <p className="text-sm text-gray-600">{nextAction.description}</p>
          {nextAction.deadline && (
            <p className="text-xs text-gray-400 mt-1">Due: {formatDate(nextAction.deadline)}</p>
          )}
        </div>
        <Link
          href={`/companies/${company.id}`}
          className={cn("flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors", ctaStyles[nextAction.priority])}
        >
          {nextAction.label}
        </Link>
      </div>
    </div>
  );
}

function ActivityItemRow({ item }: { item: ActivityItem }) {
  const typeIcons: Record<string, string> = {
    reply_received: "\uD83D\uDCAC",
    interview_scheduled: "\uD83D\uDCC5",
    follow_up_sent: "\uD83D\uDCE8",
    discovered: "\uD83D\uDD0D",
    outreach_sent: "\uD83D\uDCE7",
    researched: "\uD83D\uDCCA",
  };

  return (
    <div className="flex items-start gap-3 py-3">
      <span className="text-lg flex-shrink-0 mt-0.5">{typeIcons[item.type] || "\uD83D\uDCCC"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/companies/${item.companyId}`} className="text-sm font-medium text-gray-900 hover:text-green-700">
            {item.title}
          </Link>
          <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(item.timestamp)}</span>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
      </div>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="h-8 skeleton w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 skeleton rounded-xl" />
        ))}
      </div>
      <div className="h-64 skeleton rounded-xl" />
    </div>
  );
}

export default function OverviewPage() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [s, a, c] = await Promise.all([
        fetchPipelineStats(),
        fetchActivityFeed(),
        fetchCompanies(),
      ]);
      setStats(s);
      setActivity(a);
      setCompanies(c);
      setLoading(false);
    }
    load();
  }, []);

  if (loading || !stats) return <SkeletonLoader />;

  const actionItems = companies
    .filter((c) => c.nextAction && c.nextAction.priority !== "low")
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.nextAction!.priority] - order[b.nextAction!.priority];
    });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Your internship search at a glance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Companies" value={stats.totalCompanies} color="text-gray-900" href="/companies" />
        <StatCard label="Action Items" value={stats.actionItemsCount} color="text-amber-600" />
        <StatCard label="Pending Replies" value={stats.repliesPending} color="text-red-600" href="/replies" />
        <StatCard label="Interviews" value={stats.interviewsScheduled} color="text-green-600" />
      </div>

      {/* Pipeline Mini Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Pipeline Overview</h2>
          <Link href="/pipeline" className="text-sm text-green-600 hover:text-green-700 font-medium">
            View full pipeline \u2192
          </Link>
        </div>
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
          {PIPELINE_STAGES.map((stage) => {
            const count = stats.byStage[stage.key];
            if (count === 0) return null;
            const width = (count / stats.totalCompanies) * 100;
            const colors: Record<string, string> = {
              discovered: "bg-slate-300",
              researched: "bg-blue-300",
              outreach_sent: "bg-amber-300",
              followed_up: "bg-orange-300",
              replied: "bg-emerald-300",
              interview: "bg-green-400",
              done: "bg-gray-300",
            };
            return (
              <div
                key={stage.key}
                className={cn("flex items-center justify-center text-xs font-medium", colors[stage.key])}
                style={{ width: `${width}%` }}
                title={`${stage.label}: ${count}`}
              >
                {width > 10 && count}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          {PIPELINE_STAGES.map((stage) => {
            const count = stats.byStage[stage.key];
            if (count === 0) return null;
            return (
              <span key={stage.key} className="text-xs text-gray-500">
                {stage.label}: {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* Action Items */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Action Items</h2>
            <p className="text-xs text-gray-500 mt-0.5">What needs your attention right now</p>
          </div>
          <span className="text-sm font-medium text-amber-600">{actionItems.length} pending</span>
        </div>
        <div className="space-y-3">
          {actionItems.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">All caught up! No urgent actions needed.</p>
          ) : (
            actionItems.map((company) => (
              <ActionItemCard key={company.id} company={company} />
            ))
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Recent Activity</h2>
        <div className="divide-y divide-gray-100">
          {activity.map((item) => (
            <ActivityItemRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
