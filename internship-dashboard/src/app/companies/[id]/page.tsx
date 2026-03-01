"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCompany } from "@/lib/api";
import { Company, PIPELINE_STAGES } from "@/lib/types";
import {
  formatDate,
  formatFullDate,
  getConfidenceBadge,
  getDraftConfidenceColor,
  getDraftConfidenceLabel,
  getTimelineIcon,
  getTimelineColor,
  cn,
} from "@/lib/utils";

function TimelineView({ company }: { company: Company }) {
  const sortedEvents = [...company.timeline].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="space-y-0">
      {sortedEvents.map((event, idx) => (
        <div key={event.id} className={cn("flex gap-4 pb-6", idx < sortedEvents.length - 1 && "timeline-line")}>
          <div className="flex-shrink-0 relative z-10">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-lg", getTimelineColor(event.type))}>
              {getTimelineIcon(event.type)}
            </div>
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-semibold text-gray-900">{event.title}</h4>
              <span className="text-xs text-gray-400">{formatDate(event.timestamp)}</span>
            </div>
            <p className="text-sm text-gray-600">{event.description}</p>
            {event.metadata && (
              <div className="mt-1 text-xs text-gray-400">
                {Object.entries(event.metadata).map(([key, value]) => (
                  <span key={key} className="mr-3">
                    {key}: {String(value)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-700">{title}</span>
        <svg
          className={cn("w-4 h-4 text-gray-500 transition-transform", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="h-6 skeleton w-32" />
      <div className="h-10 skeleton w-64" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-96 skeleton rounded-xl" />
        <div className="h-64 skeleton rounded-xl" />
      </div>
    </div>
  );
}

export default function CompanyDetailPage() {
  const params = useParams();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (params.id) {
        const data = await fetchCompany(params.id as string);
        setCompany(data);
      }
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (loading) return <SkeletonLoader />;

  if (!company) {
    return (
      <div className="p-6 lg:p-8">
        <Link href="/companies" className="text-sm text-green-600 hover:text-green-700 mb-4 inline-block">
          ← Back to Companies
        </Link>
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg">Company not found.</p>
        </div>
      </div>
    );
  }

  const stageConfig = PIPELINE_STAGES.find((s) => s.key === company.stage);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Breadcrumb */}
      <Link href="/companies" className="text-sm text-green-600 hover:text-green-700 inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Companies
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
              <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full", stageConfig?.color)}>
                {stageConfig?.label}
              </span>
            </div>
            <p className="text-gray-600 mb-3">{company.description}</p>
            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              <span>{company.location}</span>
              <span>{company.fundingStage}</span>
              <span>{company.teamSize} people</span>
              <span>{company.aiFocus}</span>
              <a href={company.website} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-700">
                {company.website} ↗
              </a>
            </div>
          </div>

          {/* Next Action CTA */}
          {company.nextAction && (
            <div className={cn(
              "flex-shrink-0 border rounded-lg p-4 text-center min-w-[200px]",
              company.nextAction.priority === "high" ? "border-red-200 bg-red-50" :
              company.nextAction.priority === "medium" ? "border-amber-200 bg-amber-50" :
              "border-gray-200 bg-gray-50"
            )}>
              <p className="text-xs text-gray-500 mb-1">Next Step</p>
              <p className="text-sm font-semibold text-gray-900 mb-2">{company.nextAction.label}</p>
              {company.nextAction.deadline && (
                <p className="text-xs text-gray-400 mb-2">Due: {formatDate(company.nextAction.deadline)}</p>
              )}
              <button className={cn(
                "w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                company.nextAction.priority === "high" ? "bg-red-600 hover:bg-red-700 text-white" :
                company.nextAction.priority === "medium" ? "bg-amber-600 hover:bg-amber-700 text-white" :
                "bg-gray-600 hover:bg-gray-700 text-white"
              )}>
                {company.nextAction.label}
              </button>
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-gray-100">
          {company.tags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Timeline */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timeline */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-6">Timeline</h2>
            <TimelineView company={company} />
          </div>

          {/* Outreach Draft */}
          {company.outreachDraft && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Outreach Draft</h2>
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm font-medium", getDraftConfidenceColor(company.outreachDraft.confidence))}>
                    {company.outreachDraft.confidence}% confidence
                  </span>
                  <span className="text-xs text-gray-400">
                    ({getDraftConfidenceLabel(company.outreachDraft.confidence)})
                  </span>
                </div>
              </div>

              {/* Confidence bar */}
              <div className="w-full bg-gray-200 rounded-full h-1.5 mb-4">
                <div
                  className={cn(
                    "h-1.5 rounded-full",
                    company.outreachDraft.confidence >= 80 ? "bg-green-500" :
                    company.outreachDraft.confidence >= 60 ? "bg-yellow-500" : "bg-red-500"
                  )}
                  style={{ width: `${company.outreachDraft.confidence}%` }}
                />
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Subject</p>
                  <p className="text-sm font-medium text-gray-900">{company.outreachDraft.subject}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Body</p>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-line">
                    {company.outreachDraft.body}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>Sent to: {company.outreachDraft.contactUsed.name} ({company.outreachDraft.contactUsed.email})</span>
                  <span>·</span>
                  <span>Generated: {formatDate(company.outreachDraft.generatedAt)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Research Summary */}
          {company.researchSummary && (
            <CollapsibleSection title="Research Summary" defaultOpen={true}>
              <p className="text-sm text-gray-700 leading-relaxed">{company.researchSummary}</p>
            </CollapsibleSection>
          )}

          {/* Notes */}
          {company.notes && (
            <CollapsibleSection title="Notes">
              <p className="text-sm text-gray-700">{company.notes}</p>
            </CollapsibleSection>
          )}
        </div>

        {/* Right Column - Info Panel */}
        <div className="space-y-6">
          {/* Contacts */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Contacts</h3>
            <div className="space-y-3">
              {company.contacts.map((contact, idx) => {
                const badge = getConfidenceBadge(contact.confidence);
                return (
                  <div key={idx} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-gray-900">{contact.name}</p>
                      <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5", badge.className)}>
                        {badge.icon} {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{contact.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{contact.email}</p>
                    <p className="text-xs text-gray-400 mt-1">Source: {contact.source}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Details</h3>
            <dl className="space-y-2.5">
              <div>
                <dt className="text-xs text-gray-500">AI Focus</dt>
                <dd className="text-sm text-gray-900">{company.aiFocus}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Funding</dt>
                <dd className="text-sm text-gray-900">{company.fundingStage}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Team Size</dt>
                <dd className="text-sm text-gray-900">{company.teamSize}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Location</dt>
                <dd className="text-sm text-gray-900">{company.location}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Discovered</dt>
                <dd className="text-sm text-gray-900">{formatFullDate(company.discoveredAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Last Activity</dt>
                <dd className="text-sm text-gray-900">{formatFullDate(company.lastActivityAt)}</dd>
              </div>
            </dl>
          </div>

          {/* Website Link */}
          <a
            href={company.website}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-white rounded-xl border border-gray-200 p-4 text-center text-sm font-medium text-green-600 hover:bg-green-50 transition-colors"
          >
            Visit Website ↗
          </a>
        </div>
      </div>
    </div>
  );
}
