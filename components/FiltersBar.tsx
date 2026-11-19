import { useState, type CSSProperties, type ReactNode } from "react";

import {
  Categories,
  COLLAPSED_TOPICS_PER_GROUP,
  TOPIC_GROUP_PRESENTATION,
} from "../appConfig";
import type { SearchFilters, TopicDefinition, TopicVocabulary } from "../types";
import { paperColor } from "../utils/flyerWall";

type TopicGroupValue = (typeof TOPIC_GROUP_PRESENTATION)[number]["value"];

function sortTopicsByAvailability(
  topics: TopicDefinition[],
  topicCounts: ReadonlyMap<string, number>,
): TopicDefinition[] {
  return topics
    .map((topic, publishedIndex) => ({ topic, publishedIndex }))
    .sort(
      (left, right) =>
        (topicCounts.get(right.topic.slug) ?? 0) -
          (topicCounts.get(left.topic.slug) ?? 0) ||
        left.publishedIndex - right.publishedIndex,
    )
    .map(({ topic }) => topic);
}

function topicsForGroup(
  topicVocabulary: TopicVocabulary | null,
  group: TopicGroupValue,
  topicCounts: ReadonlyMap<string, number>,
): TopicDefinition[] {
  if (!topicVocabulary) {
    return [];
  }

  return sortTopicsByAvailability(
    topicVocabulary.topics.filter((topic) => topic.group === group),
    topicCounts,
  );
}

function collapsedTopics(
  topics: TopicDefinition[],
  activeTopic: string,
): TopicDefinition[] {
  const commonTopics = topics.slice(0, COLLAPSED_TOPICS_PER_GROUP);
  const selectedTopic = topics.find((topic) => topic.slug === activeTopic);

  if (
    selectedTopic &&
    !commonTopics.some((topic) => topic.slug === selectedTopic.slug)
  ) {
    return [...commonTopics, selectedTopic];
  }

  return commonTopics;
}

function TopicChip({
  topic,
  count,
  active,
  onTopicChange,
}: {
  topic: TopicDefinition;
  count: number;
  active: boolean;
  onTopicChange: (next: string) => void;
}) {
  return (
    <button
      type="button"
      data-topic-slug={topic.slug}
      aria-label={`${topic.label}, ${count} ${count === 1 ? "event" : "events"}`}
      aria-pressed={active}
      disabled={count === 0}
      onClick={() => onTopicChange(topic.slug)}
      className="scrap topic"
    >
      <span>{topic.label}</span>
      <span aria-hidden="true" className="count">
        {count}
      </span>
    </button>
  );
}

function TopicGroup({
  label,
  topics,
  filters,
  topicCounts,
  onTopicChange,
}: {
  label: string;
  topics: TopicDefinition[];
  filters: SearchFilters;
  topicCounts: ReadonlyMap<string, number>;
  onTopicChange: (next: string) => void;
}) {
  if (topics.length === 0) {
    return null;
  }

  return (
    <div className="topic-group min-w-0">
      <p className="wall-label">{label}</p>
      <div className="scraps">
        {topics.map((topic) => (
          <TopicChip
            key={topic.slug}
            topic={topic}
            count={topicCounts.get(topic.slug) ?? 0}
            active={filters.topic === topic.slug}
            onTopicChange={onTopicChange}
          />
        ))}
      </div>
    </div>
  );
}

/** Category scraps: each one is a scrap of that category's paper. */
function CategoryScraps({
  category,
  onCategoryChange,
  children,
}: {
  category: string;
  onCategoryChange: (next: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="scraps">
      {Categories.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={category === value}
          onClick={() => onCategoryChange(value)}
          className="scrap"
          style={{ "--p": paperColor(value) } as CSSProperties}
        >
          {value}
        </button>
      ))}
      {children}
    </div>
  );
}

// There is no source control. A source arrives from search words, a shared
// link, or an agent, and the chip row shows it with a × to clear it.
export function DesktopFiltersBar({
  filters,
  topicVocabulary,
  topicCounts,
  onCategoryChange,
  onTopicChange,
}: {
  filters: SearchFilters;
  topicVocabulary: TopicVocabulary | null;
  topicCounts: ReadonlyMap<string, number>;
  onCategoryChange: (next: string) => void;
  onTopicChange: (next: string) => void;
}) {
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const topicGroups = TOPIC_GROUP_PRESENTATION.map((group) => {
    const topics = topicsForGroup(topicVocabulary, group.value, topicCounts);
    return {
      ...group,
      topics: topicsExpanded ? topics : collapsedTopics(topics, filters.topic),
      totalCount: topics.length,
    };
  });
  const hasMoreTopics = topicGroups.some(
    (group) => group.totalCount > COLLAPSED_TOPICS_PER_GROUP,
  );

  return (
    <div className="legend beside">
      <CategoryScraps
        category={filters.category}
        onCategoryChange={onCategoryChange}
      />

      {topicVocabulary && (
        <div id="desktop-topic-filters" data-testid="desktop-topic-filters">
          <div className="topic-groups">
            {topicGroups.map((group) => (
              <TopicGroup
                key={group.value}
                label={group.label}
                topics={group.topics}
                filters={filters}
                topicCounts={topicCounts}
                onTopicChange={onTopicChange}
              />
            ))}
          </div>
          {hasMoreTopics && (
            <button
              type="button"
              aria-expanded={topicsExpanded}
              aria-controls="desktop-topic-filters"
              onClick={() => setTopicsExpanded((expanded) => !expanded)}
              className="chalk-link"
            >
              {topicsExpanded ? "Fewer topics" : "More topics"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function MobileFiltersBar({
  filters,
  topicVocabulary,
  topicCounts,
  onCategoryChange,
  onTopicChange,
  onClearAll = null,
}: {
  filters: SearchFilters;
  topicVocabulary: TopicVocabulary | null;
  topicCounts: ReadonlyMap<string, number>;
  onCategoryChange: (next: string) => void;
  onTopicChange: (next: string) => void;
  /** Resets every filter. Null hides "Clear all". */
  onClearAll?: (() => void) | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // The count covers only what the drawer holds: the topic. Categories sit
  // on the wall beside it.
  const activeFilterCount = Number(Boolean(filters.topic));
  const selectedTopic = topicVocabulary?.topics.find(
    (topic) => topic.slug === filters.topic,
  );

  return (
    <div className="legend beside">
      <CategoryScraps
        category={filters.category}
        onCategoryChange={onCategoryChange}
      >
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls="mobile-filters"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="scrap scrap-dark"
        >
          Filters
          {activeFilterCount > 0 && (
            <span className="count">{activeFilterCount}</span>
          )}
        </button>
      </CategoryScraps>

      {advancedOpen && (
        <div id="mobile-filters" className="drawer">
          <div className="drawer-head">
            <div>
              <p>
                Category: <b>{filters.category}</b>
              </p>
              <p>
                Topic: <b>{selectedTopic?.label ?? "All topics"}</b>
              </p>
            </div>
            <div className="drawer-actions">
              {onClearAll && (
                <button type="button" onClick={onClearAll} className="done">
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setAdvancedOpen(false)}
                className="done"
              >
                Done
              </button>
            </div>
          </div>

          {topicVocabulary && (
            <div className="drawer-section topic-groups">
              {TOPIC_GROUP_PRESENTATION.map((group) => (
                <TopicGroup
                  key={group.value}
                  label={group.label}
                  topics={topicsForGroup(
                    topicVocabulary,
                    group.value,
                    topicCounts,
                  )}
                  filters={filters}
                  topicCounts={topicCounts}
                  onTopicChange={onTopicChange}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
