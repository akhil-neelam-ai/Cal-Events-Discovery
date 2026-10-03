import type { LegacyCalEvent, TopicAssignmentStatus } from "./schema.js";
import {
  assignTopics,
  groupTopicSlugs,
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

export interface TopicAssignmentOptions {
  /** Last-good rows keep the topics already on the published event. */
  preserveTopicIds?: ReadonlySet<string>;
  /**
   * LiveWhale department feeds that failed this run. A LiveWhale event keeps
   * any prior topic that only those groups can give. Every other topic, and
   * every other source, is assigned as usual.
   */
  missingGroups?: readonly string[];
  /** Set when every group feed failed. The stage reports it as an error. */
  provenanceError?: string;
}

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

export function assertValidTopicAssignment(
  assigned: unknown,
  eventId: string,
): TopicSlug[] {
  if (!Array.isArray(assigned)) {
    throw new Error(`topic assignment for ${eventId} returned a non-array`);
  }
  if (assigned.length > 3) {
    throw new Error(
      `topic assignment for ${eventId} returned ${assigned.length} slugs`,
    );
  }

  const unique = new Set<string>();
  const slugs: TopicSlug[] = [];
  for (const slug of assigned) {
    if (typeof slug !== "string" || !TOPIC_BY_SLUG.has(slug as TopicSlug)) {
      throw new Error(
        `topic assignment for ${eventId} returned unknown slug ${String(slug)}`,
      );
    }
    if (unique.has(slug)) {
      throw new Error(
        `topic assignment for ${eventId} returned duplicate slug ${slug}`,
      );
    }
    unique.add(slug);
    slugs.push(slug as TopicSlug);
  }
  return slugs;
}

/**
 * Assign topics as one isolated stage. If any assignment throws or returns an
 * invalid slug list, discard the partial results and carry yesterday's valid
 * topics forward by event id. Projection, source recovery, schema validation,
 * and file writes remain outside this boundary so their failures still stop
 * publication.
 */
export function assignTopicsResiliently(
  candidates: readonly TopicAssignmentCandidate[],
  previousEvents: readonly LegacyCalEvent[],
  assigner: TopicAssigner = assignTopics,
  options: TopicAssignmentOptions = {},
): TopicAssignmentResult {
  const events = candidates.map(({ published }) => ({ ...published }));
  const previousById = new Map(
    previousEvents.map((event) => [event.id, event]),
  );
  const preserveTopicIds = options.preserveTopicIds ?? new Set<string>();
  const missingGroupTopics = groupTopicSlugs(options.missingGroups ?? []);

  let assignments: Array<TopicSlug[] | "preserved">;
  try {
    assignments = candidates.map(({ published, source }) => {
      if (preserveTopicIds.has(published.id)) {
        return "preserved";
      }
      return assertValidTopicAssignment(assigner(source), published.id);
    });
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
    const assignedTopics = assignments[index];
    if (assignedTopics === "preserved") {
      event.topics = validPreviousTopics(event);
      if (event.topics.length > 0) carriedForwardCount += 1;
      continue;
    }

    const carried =
      event.source === "livewhale" && missingGroupTopics.size > 0
        ? validPreviousTopics(previousById.get(event.id)).filter(
            (slug) =>
              missingGroupTopics.has(slug) && !assignedTopics.includes(slug),
          )
        : [];
    event.topics = [...assignedTopics, ...carried].slice(0, 3);
    if (assignedTopics.length > 0) assignedCount += 1;
    if (carried.length > 0) carriedForwardCount += 1;
  }

  const counts = {
    assigned_count: assignedCount,
    carried_forward_count: carriedForwardCount,
  };
  return {
    events,
    status: options.provenanceError
      ? { outcome: "error", ...counts, error: options.provenanceError }
      : { outcome: "ok", ...counts },
  };
}
