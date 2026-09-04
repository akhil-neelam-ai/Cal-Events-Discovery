import type { LegacyCalEvent, TopicAssignmentStatus } from "./schema.js";
import {
  assignTopics,
  TOPIC_BY_SLUG,
  type TopicAssignableEvent,
  type TopicSlug,
} from "./topics.js";

export interface TopicAssignmentCandidate {
  published: LegacyCalEvent;
  source: TopicAssignableEvent;
}

export interface TopicAssignmentResult {
  events: LegacyCalEvent[];
  status: TopicAssignmentStatus;
}

export type TopicAssigner = (event: TopicAssignableEvent) => TopicSlug[];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validPreviousTopics(event: LegacyCalEvent | undefined): TopicSlug[] {
  if (!event?.topics) return [];

  return Array.from(
    new Set(
      event.topics.filter((topic): topic is TopicSlug =>
        TOPIC_BY_SLUG.has(topic),
      ),
    ),
  ).slice(0, 3);
}

function applyPreviousTopics(
  events: LegacyCalEvent[],
  previousById: ReadonlyMap<string, LegacyCalEvent>,
): number {
  let carriedForwardCount = 0;

  for (const event of events) {
    const previousTopics = validPreviousTopics(previousById.get(event.id));
    event.topics = previousTopics;
    if (previousTopics.length > 0) carriedForwardCount += 1;
  }

  return carriedForwardCount;
}

/**
 * Assign topics as one isolated stage. If any assignment throws, discard the
 * partial results and carry yesterday's valid topics forward by event id.
 * Projection, source recovery, schema validation, and file writes remain
 * outside this boundary so their failures still stop publication.
 */
export function assignTopicsResiliently(
  candidates: readonly TopicAssignmentCandidate[],
  previousEvents: readonly LegacyCalEvent[],
  assigner: TopicAssigner = assignTopics,
): TopicAssignmentResult {
  const events = candidates.map(({ published }) => ({ ...published }));
  const previousById = new Map(
    previousEvents.map((event) => [event.id, event]),
  );

  let assignments: TopicSlug[][];
  try {
    assignments = candidates.map(({ source }) => assigner(source));
  } catch (error) {
    return {
      events,
      status: {
        outcome: "error",
        assigned_count: 0,
        carried_forward_count: applyPreviousTopics(events, previousById),
        error: errorMessage(error),
      },
    };
  }

  let assignedCount = 0;
  let carriedForwardCount = 0;
  for (const [index, event] of events.entries()) {
    const assignedTopics = assignments[index] ?? [];
    if (assignedTopics.length > 0) {
      event.topics = assignedTopics;
      assignedCount += 1;
      continue;
    }

    const previousTopics = validPreviousTopics(previousById.get(event.id));
    event.topics = previousTopics;
    if (previousTopics.length > 0) carriedForwardCount += 1;
  }

  return {
    events,
    status: {
      outcome: "ok",
      assigned_count: assignedCount,
      carried_forward_count: carriedForwardCount,
    },
  };
}
