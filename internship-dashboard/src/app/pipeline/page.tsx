"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCompanies } from "@/lib/api";
import { Company, PipelineStage, PIPELINE_STAGES } from "@/lib/types";
import { formatDate, getConfidenceBadge, cn } from "@/lib/utils";

function PipelineCard({ company }: { company: Company }) {
  const primaryContact = company.contacts[0];
  const confidenceBadge = primaryContact ? getConfidenceBadge(primaryContact.confidence) : null;

  return (
    <Link
      href={`/companies/${company.id}`}
      className="block bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-sm font-semibold text-gray-900 truncate">{company.name}</h3>
        {company.nextAction?.priority === "high" && (
          <span className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full" title="Urgent" />
        )}
      </div>
      <p className="text-xs text-gray-500 line-clamp-2 mb-2">{company.aiFocus}</p>

      {/* Contact confidence */}
      {confidenceBadge && (
        <div className="flex items-center gap-1 mb-2">
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", confidenceBadge.className)}>
            {confidenceBadge.icon} {confidenceBadge.label}
          </span>
          {primaryContact && (
            <span className="text-[10px] text-gray-400 truncate">{primaryContact.name}</span>
          )}
        </div>
      )}

      {/* Next action */}
      {company.nextAction && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-400">Next: {company.nextAction.label}</p>
          {company.nextAction.deadline && (
            <p className="text-[10px] text-gray-400">{formatDate(company.nextAction.deadline)}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-gray-300">{formatDate(company.lastActivityAt)}</span>
        <div className="flex gap-0.5">
          {company.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function SkeletonLoader() {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="h-8 skeleton w-48" />
      <div className="flex gap-4 overflow-x-auto">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="w-72 flex-shrink-0 h-96 skeleton rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await fetchCompanies();
      setCompanies(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <SkeletonLoader />;

  const stageColors: Record<PipelineStage, string> = {
    discovered: "border-t-slate-400",
    researched: "border-t-blue-400",
    outreach_sent: "border-t-amber-400",
    followed_up: "border-t-orange-400",
    replied: "border-t-emerald-400",
    interview: "border-t-green-500",
    done: "border-t-gray-300",
  };

  const stageBgColors: Record<PipelineStage, string> = {
    discovered: "bg-slate-50",
    researched: "bg-blue-50",
    outreach_sent: "bg-amber-50",
    followed_up: "bg-orange-50",
    replied: "bg-emerald-50",
    interview: "bg-green-50",
    done: "bg-gray-50",
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">Track companies through your outreach pipeline</p>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map((stage) => {
          const stageCompanies = companies.filter((c) => c.stage === stage.key);
          return (
            <div
              key={stage.key}
              className={cn(
                "flex-shrink-0 w-72 rounded-xl border border-gray-200 border-t-4 overflow-hidden",
                stageColors[stage.key]
              )}
            >
              {/* Column Header */}
              <div className={cn("p-3 border-b border-gray-200", stageBgColors[stage.key])}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">{stage.label}</h3>
                  <span className="text-xs text-gray-400 bg-white px-1.5 py-0.5 rounded-full">
                    {stageCompanies.length}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 min-h-[200px] bg-gray-50/50">
                {stageCompanies.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-xs text-gray-400">
                    No companies
                  </div>
                ) : (
                  stageCompanies.map((company) => (
                    <PipelineCard key={company.id} company={company} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm">
            <span className="text-gray-500">
              <strong className="text-gray-900">{companies.length}</strong> total companies
            </span>
            <span className="text-gray-500">
              <strong className="text-green-600">
                {companies.filter((c) => c.stage === "interview").length}
              </strong>{" "}
              at interview stage
            </span>
            <span className="text-gray-500">
              <strong className="text-amber-600">
                {companies.filter((c) => c.nextAction?.priority === "high").length}
              </strong>{" "}
              urgent actions
            </span>
          </div>
          <Link href="/companies" className="text-sm text-green-600 hover:text-green-700 font-medium">
            View as list →
          </Link>
        </div>
      </div>
    </div>
  );
}
