import {
  Company,
  Reply,
  PipelineStats,
  ActivityItem,
  DiscoveryResult,
  PipelineStage,
  ReplyStatus,
} from "./types";
import {
  mockCompanies,
  mockReplies,
  mockPipelineStats,
  mockActivityFeed,
  mockDiscoveryResult,
} from "./mock-data";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Simulate network delay for realistic UX
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// In production, these would be real API calls to FastAPI backend
// For now, we use mock data with the same interface

export async function fetchCompanies(stage?: PipelineStage): Promise<Company[]> {
  await delay(300);
  if (stage) {
    return mockCompanies.filter((c) => c.stage === stage);
  }
  return mockCompanies;
}

export async function fetchCompany(id: string): Promise<Company | null> {
  await delay(200);
  return mockCompanies.find((c) => c.id === id) || null;
}

export async function fetchReplies(status?: ReplyStatus): Promise<Reply[]> {
  await delay(300);
  if (status) {
    return mockReplies.filter((r) => r.status === status);
  }
  return mockReplies;
}

export async function fetchPipelineStats(): Promise<PipelineStats> {
  await delay(200);
  return mockPipelineStats;
}

export async function fetchActivityFeed(): Promise<ActivityItem[]> {
  await delay(250);
  return mockActivityFeed;
}

export async function fetchDiscoveryResults(): Promise<DiscoveryResult> {
  await delay(300);
  return mockDiscoveryResult;
}

// Action endpoints (would POST to FastAPI in production)
export async function triggerResearch(companyId: string): Promise<{ success: boolean; message: string }> {
  await delay(500);
  return { success: true, message: `Research started for company ${companyId}` };
}

export async function generateOutreach(companyId: string): Promise<{ success: boolean; message: string }> {
  await delay(500);
  return { success: true, message: `Outreach draft generated for company ${companyId}` };
}

export async function sendOutreach(companyId: string): Promise<{ success: boolean; message: string }> {
  await delay(500);
  return { success: true, message: `Outreach sent for company ${companyId}` };
}

export async function sendFollowUp(companyId: string): Promise<{ success: boolean; message: string }> {
  await delay(500);
  return { success: true, message: `Follow-up sent for company ${companyId}` };
}

export async function updateReplyStatus(
  replyId: string,
  status: ReplyStatus,
  snoozeUntil?: string
): Promise<{ success: boolean }> {
  // In production, would POST to `${API_BASE}/replies/${replyId}/status`
  void replyId; void status; void snoozeUntil;
  await delay(300);
  return { success: true };
}

export async function runDiscoveryScan(): Promise<{ success: boolean; message: string }> {
  await delay(1000);
  return { success: true, message: "Discovery scan completed" };
}

// Export base URL for reference
export { API_BASE };
