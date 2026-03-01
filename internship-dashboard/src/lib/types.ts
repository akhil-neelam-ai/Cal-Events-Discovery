// Pipeline stages for companies
export type PipelineStage =
  | "discovered"
  | "researched"
  | "outreach_sent"
  | "followed_up"
  | "replied"
  | "interview"
  | "done";

export const PIPELINE_STAGES: { key: PipelineStage; label: string; color: string }[] = [
  { key: "discovered", label: "Discovered", color: "bg-slate-100 text-slate-700" },
  { key: "researched", label: "Researched", color: "bg-blue-100 text-blue-700" },
  { key: "outreach_sent", label: "Outreach Sent", color: "bg-amber-100 text-amber-700" },
  { key: "followed_up", label: "Followed Up", color: "bg-orange-100 text-orange-700" },
  { key: "replied", label: "Replied", color: "bg-emerald-100 text-emerald-700" },
  { key: "interview", label: "Interview", color: "bg-green-100 text-green-800" },
  { key: "done", label: "Done", color: "bg-gray-100 text-gray-600" },
];

// Contact confidence levels
export type ContactConfidence = "verified" | "guessed" | "unknown";

export interface Contact {
  name: string;
  title: string;
  email: string;
  confidence: ContactConfidence;
  source: string;
}

// Company data model
export interface Company {
  id: string;
  name: string;
  description: string;
  website: string;
  location: string;
  stage: PipelineStage;
  tags: string[];
  contacts: Contact[];
  fundingStage: string;
  teamSize: string;
  aiFocus: string;
  discoveredAt: string;
  lastActivityAt: string;
  nextAction: NextAction | null;
  researchSummary: string | null;
  outreachDraft: OutreachDraft | null;
  timeline: TimelineEvent[];
  notes: string;
}

// Next action CTA for action-first pipeline
export interface NextAction {
  type: "research" | "draft_outreach" | "send_outreach" | "follow_up" | "respond" | "schedule_interview" | "review";
  label: string;
  description: string;
  deadline: string | null;
  priority: "high" | "medium" | "low";
}

// Outreach draft with confidence
export interface OutreachDraft {
  subject: string;
  body: string;
  confidence: number; // 0-100
  generatedAt: string;
  contactUsed: Contact;
}

// Timeline events for company detail view
export type TimelineEventType =
  | "discovered"
  | "researched"
  | "outreach_drafted"
  | "outreach_sent"
  | "follow_up_sent"
  | "reply_received"
  | "interview_scheduled"
  | "note_added"
  | "status_changed";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean>;
}

// Reply urgency for inbox triage
export type ReplyUrgency = "hot" | "warm" | "cold";

export type ReplyStatus = "new" | "in_progress" | "snoozed" | "done";

export interface Reply {
  id: string;
  companyId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  urgency: ReplyUrgency;
  status: ReplyStatus;
  suggestedAction: string;
  category: string; // e.g., "interview_invite", "follow_up_question", "rejection", "auto_reply"
  snoozeUntil: string | null;
}

// Pipeline stats for overview
export interface PipelineStats {
  totalCompanies: number;
  byStage: Record<PipelineStage, number>;
  actionItemsCount: number;
  repliesPending: number;
  outreachSentThisWeek: number;
  interviewsScheduled: number;
}

// Activity feed item for overview
export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  companyId: string;
  companyName: string;
}

// Discovery scan result
export interface DiscoveryResult {
  companiesFound: number;
  newCompanies: number;
  source: string;
  scanDate: string;
  summary: string;
  topFinds: { name: string; reason: string }[];
}
