"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCompanies } from "@/lib/api";
import { Company, PipelineStage, PIPELINE_STAGES } from "@/lib/types";
import { formatDate, getConfidenceBadge, cn } from "@/lib/utils";

function CompanyCard({ company }: { company: Company }) {
  const stageConfig = PIPELINE_STAGES.find((s) => s.key === company.stage);
  const primaryContact = company.contacts[0];
  const confidenceBadge = primaryContact ? getConfidenceBadge(primaryContact.confidence) : null;

  const ctaConfig: Record<string, { label: string; className: string }> = {
    research: { label: "Start Research", className: "bg-blue-600 hover:bg-blue-700 text-white" },
    draft_outreach: { label: "Draft Email", className: "bg-indigo-600 hover:bg-indigo-700 text-white" },
    send_outreach: { label: "Send Outreach", className: "bg-amber-600 hover:bg-amber-700 text-white" },
    follow_up: { label: "Send Follow-up", className: "bg-orange-600 hover:bg-orange-700 text-white" },
    respond: { label: "Reply Now", className: "bg-red-600 hover:bg-red-700 text-white" },
    schedule_interview: { label: "Prepare Interview", className: "bg-green-600 hover:bg-green-700 text-white" },
    review: { label: "Review", className: "bg-gray-600 hover:bg-gray-700 text-white" },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/companies/${company.id}`} className="font-semibold text-gray-900 hover:text-green-700 text-lg">
              {company.name}
            </Link>
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", stageConfig?.color)}>
              {stageConfig?.label}
            </span>
          </div>
          <p className="text-sm text-gray-500 line-clamp-2">{company.description}</p>
        </div>
      </div>

      {/* Meta info */}
      <div className="flex flex-wrap gap-3 mb-3 text-xs text-gray-500">
        <span>{company.location}</span>
        <span>{company.fundingStage}</span>
        <span>{company.teamSize} people</span>
        <span className="text-gray-400">Discovered {formatDate(company.discoveredAt)}</span>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {company.tags.map((tag) => (
          <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
      </div>

      {/* Contact with confidence indicator */}
      {primaryContact && (
        <div className="flex items-center gap-2 mb-4 p-2 bg-gray-50 rounded-lg">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700 truncate">{primaryContact.name}</p>
            <p className="text-xs text-gray-500 truncate">{primaryContact.title} &middot; {primaryContact.email}</p>
          </div>
          {confidenceBadge && (
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1", confidenceBadge.className)}>
              <span>{confidenceBadge.icon}</span>
              {confidenceBadge.label}
            </span>
          )}
        </div>
      )}

      {/* Action-first CTA */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        {company.nextAction ? (
          <>
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-xs text-gray-500 truncate">{company.nextAction.description}</p>
              {company.nextAction.deadline && (
                <p className="text-xs text-gray-400 mt-0.5">Due: {formatDate(company.nextAction.deadline)}</p>
              )}
            </div>
            <Link
              href={`/companies/${company.id}`}
              className={cn(
                "flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                ctaConfig[company.nextAction.type]?.className || "bg-green-600 hover:bg-green-700 text-white"
              )}
            >
              {ctaConfig[company.nextAction.type]?.label || company.nextAction.label}
            </Link>
          </>
        ) : (
          <Link
            href={`/companies/${company.id}`}
            className="text-sm text-gray-500 hover:text-green-600 font-medium"
          >
            View details →
          </Link>
        )}
      </div>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="h-8 skeleton w-48" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-48 skeleton rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function load() {
      const data = await fetchCompanies();
      setCompanies(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <SkeletonLoader />;

  const filtered = companies.filter((c) => {
    const matchesStage = stageFilter === "all" || c.stage === stageFilter;
    const matchesSearch =
      searchQuery === "" ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStage && matchesSearch;
  });

  // Sort: active companies first (by priority), done last
  const sorted = [...filtered].sort((a, b) => {
    const order: Record<PipelineStage, number> = {
      interview: 0,
      replied: 1,
      followed_up: 2,
      outreach_sent: 3,
      researched: 4,
      discovered: 5,
      done: 6,
    };
    return order[a.stage] - order[b.stage];
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
          <p className="text-sm text-gray-500 mt-1">{companies.length} companies tracked</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search companies, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setStageFilter("all")}
            className={cn(
              "px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
              stageFilter === "all" ? "bg-green-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            )}
          >
            All ({companies.length})
          </button>
          {PIPELINE_STAGES.map((stage) => {
            const count = companies.filter((c) => c.stage === stage.key).length;
            if (count === 0) return null;
            return (
              <button
                key={stage.key}
                onClick={() => setStageFilter(stage.key)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                  stageFilter === stage.key ? "bg-green-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                {stage.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Company Cards */}
      {sorted.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No companies match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sorted.map((company) => (
            <CompanyCard key={company.id} company={company} />
          ))}
        </div>
      )}
    </div>
  );
}
