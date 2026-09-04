import { useState } from "react";

import {
  Categories,
  COLLAPSED_TOPICS_PER_GROUP,
  DateRanges,
  TOPIC_GROUP_PRESENTATION,
} from "../appConfig";
import type { SourceOption } from "../appConfig";
import type { SearchFilters, TopicDefinition, TopicVocabulary } from "../types";
import { SourceDropdown } from "./SourceDropdown";

// Plain-language tooltips so the date pills (especially "All Events") are not
// ambiguous about the window they cover.
const DATE_RANGE_DESCRIPTIONS: Record<string, string> = {
  today: "Events happening today",
  week: "Events in the next 7 days",
  upcoming: "Every upcoming event on the calendar",
};

type TopicGroupValue = (typeof TOPIC_GROUP_PRESENTATION)[number]["value"];

interface TopicControlsProps {
  filters: SearchFilters;
  topicVocabulary: TopicVocabulary | null;
  topicCounts: ReadonlyMap<string, number>;
  onTopicChange: (next: string) => void;
}

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
  mobile = false,
  onTopicChange,
}: {
  topic: TopicDefinition;
  count: number;
  active: boolean;
  mobile?: boolean;
  onTopicChange: (next: string) => void;
}) {
  const unavailable = count === 0;

  return (
    <button
      type="button"
      data-topic-slug={topic.slug}
      aria-label={`${topic.label}, ${count} ${count === 1 ? "event" : "events"}`}
      aria-pressed={active}
      disabled={unavailable}
      onClick={() => onTopicChange(topic.slug)}
      className={`inline-flex select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition tap-highlight ${
        active
          ? `border-berkeley-blue bg-berkeley-blue text-white ${
              mobile ? "shadow-[0_2px_8px_rgba(0,50,98,0.2)]" : "shadow-xs"
            }`
          : unavailable
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-70"
            : `border-slate-200 bg-white text-slate-600 ${
                mobile
                  ? "active:border-slate-300 active:bg-slate-50"
                  : "hover:border-slate-300 hover:bg-slate-50 hover:text-berkeley-blue"
              }`
      }`}
    >
      <span>{topic.label}</span>
      <span
        aria-hidden="true"
        className={`text-[11px] tabular-nums ${
          active ? "text-white/75" : "text-slate-400"
        }`}
      >
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
  mobile = false,
  onTopicChange,
}: {
  label: string;
  topics: TopicDefinition[];
  filters: SearchFilters;
  topicCounts: ReadonlyMap<string, number>;
  mobile?: boolean;
  onTopicChange: (next: string) => void;
}) {
  if (topics.length === 0) {
    return null;
  }

  return (
    <div className={mobile ? undefined : "min-w-0"}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {topics.map((topic) => (
          <TopicChip
            key={topic.slug}
            topic={topic}
            count={topicCounts.get(topic.slug) ?? 0}
            active={filters.topic === topic.slug}
            mobile={mobile}
            onTopicChange={onTopicChange}
          />
        ))}
      </div>
    </div>
  );
}

export function DesktopFiltersBar({
  filters,
  activeDateRange,
  sourceOptions,
  topicVocabulary,
  topicCounts,
  onDateChange,
  onCategoryChange,
  onTopicChange,
  onSourceChange,
}: {
  filters: SearchFilters;
  activeDateRange: SearchFilters["dateRange"];
  sourceOptions: SourceOption[];
  topicVocabulary: TopicVocabulary | null;
  topicCounts: ReadonlyMap<string, number>;
  onDateChange: (next: SearchFilters["dateRange"]) => void;
  onCategoryChange: (next: string) => void;
  onTopicChange: (next: string) => void;
  onSourceChange: (next: string) => void;
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
    <div
      className="bg-white/90 backdrop-blur-md"
      style={{ boxShadow: "0 1px 0 rgba(253,181,21,0.22)" }}
    >
      <div className="container mx-auto flex items-center gap-3 overflow-x-auto whitespace-nowrap px-4 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300">
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 p-1 shadow-inner">
          {DateRanges.map((range) => {
            const active = activeDateRange === range.value;
            return (
              <button
                key={range.value}
                type="button"
                title={DATE_RANGE_DESCRIPTIONS[range.value]}
                onClick={() =>
                  onDateChange(range.value as SearchFilters["dateRange"])
                }
                className={`px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "rounded-none border-b-2 border-[#FDB515] bg-transparent text-berkeley-blue"
                    : "rounded-full text-slate-600 hover:bg-white hover:text-berkeley-blue"
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        <div className="hidden h-6 w-px shrink-0 bg-slate-200 lg:block" />

        <div className="flex shrink-0 items-center gap-2">
          {Categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => onCategoryChange(category)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                filters.category === category
                  ? "border-berkeley-blue bg-berkeley-blue text-white shadow-xs"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="hidden h-6 w-px shrink-0 bg-slate-200 lg:block" />

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Source
          </span>
          <SourceDropdown
            value={filters.source}
            options={sourceOptions}
            onChange={onSourceChange}
            tone="light"
          />
        </div>
      </div>

      {topicVocabulary && (
        <div
          id="desktop-topic-filters"
          data-testid="desktop-topic-filters"
          className="border-t border-slate-200/80"
        >
          <div className="container mx-auto grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
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
            {hasMoreTopics && (
              <button
                type="button"
                aria-expanded={topicsExpanded}
                aria-controls="desktop-topic-filters"
                onClick={() => setTopicsExpanded((expanded) => !expanded)}
                className="mt-5 justify-self-start rounded-full border border-berkeley-blue/20 bg-white px-3 py-1.5 text-sm font-semibold text-berkeley-blue transition hover:border-berkeley-blue/40 hover:bg-berkeley-blue/5 lg:justify-self-end"
              >
                {topicsExpanded ? "Fewer topics" : "More topics"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MobileFiltersBar({
  filters,
  activeDateRange,
  sourceOptions,
  topicVocabulary,
  topicCounts,
  onDateChange,
  onCategoryChange,
  onTopicChange,
  onSourceChange,
}: {
  filters: SearchFilters;
  activeDateRange: SearchFilters["dateRange"];
  sourceOptions: SourceOption[];
  topicVocabulary: TopicVocabulary | null;
  topicCounts: ReadonlyMap<string, number>;
  onDateChange: (next: SearchFilters["dateRange"]) => void;
  onCategoryChange: (next: string) => void;
  onTopicChange: (next: string) => void;
  onSourceChange: (next: string) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeFilterCount =
    Number(filters.category !== "All") +
    Number(filters.source !== "All") +
    Number(Boolean(filters.topic));
  const selectedSource =
    sourceOptions.find((option) => option.value === filters.source)?.label ||
    "All sources";
  const selectedTopic = topicVocabulary?.topics.find(
    (topic) => topic.slug === filters.topic,
  );

  const handleDateSelect = (next: SearchFilters["dateRange"]) => {
    setAdvancedOpen(false);
    onDateChange(next);
  };

  return (
    <div className="border-b border-slate-200/80 bg-white/95 shadow-xs backdrop-blur-md">
      <div className="container mx-auto flex items-center gap-2 overflow-x-auto whitespace-nowrap px-4 py-2.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300">
        {DateRanges.map((range) => {
          const active = activeDateRange === range.value;
          return (
            <button
              key={range.value}
              type="button"
              title={DATE_RANGE_DESCRIPTIONS[range.value]}
              onClick={() =>
                handleDateSelect(range.value as SearchFilters["dateRange"])
              }
              className={`select-none rounded-full px-4 py-2 text-sm font-semibold tap-highlight ${
                active
                  ? "bg-berkeley-blue text-white shadow-[0_2px_10px_rgba(0,50,98,0.25)]"
                  : "bg-slate-100 text-slate-600 active:bg-slate-200"
              }`}
            >
              {range.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className={`ml-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold tap-highlight select-none ${
            advancedOpen || activeFilterCount > 0
              ? "border-berkeley-blue bg-berkeley-blue text-white shadow-[0_2px_10px_rgba(0,50,98,0.25)]"
              : "border-slate-200 bg-white text-slate-700 active:bg-slate-50"
          }`}
        >
          Filters
          {activeFilterCount > 0 && (
            <span
              className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] ${advancedOpen ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {advancedOpen && (
        <div className="animate-panel-in border-t border-slate-200/80 bg-white">
          <div className="container mx-auto space-y-4 px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Filters
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Category:{" "}
                  <span className="font-medium text-slate-800">
                    {filters.category}
                  </span>
                  <span className="mx-2 text-slate-300">•</span>
                  Source:{" "}
                  <span className="font-medium text-slate-800">
                    {selectedSource}
                  </span>
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Topic:{" "}
                  <span className="font-medium text-slate-800">
                    {selectedTopic?.label ?? "All topics"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(false)}
                className="select-none rounded-full px-3 py-1.5 text-sm font-semibold text-berkeley-blue tap-highlight active:bg-slate-100"
              >
                Done
              </button>
            </div>

            {topicVocabulary && (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Topic
                </p>
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
                    mobile
                    onTopicChange={onTopicChange}
                  />
                ))}
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Category
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => onCategoryChange(category)}
                    className={`select-none rounded-full border px-3 py-1.5 text-sm tap-highlight ${
                      filters.category === category
                        ? "border-berkeley-blue bg-berkeley-blue text-white shadow-[0_2px_8px_rgba(0,50,98,0.2)]"
                        : "border-slate-200 bg-white text-slate-600 active:bg-slate-50"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Source
              </p>
              <div className="mt-2">
                <SourceDropdown
                  value={filters.source}
                  options={sourceOptions}
                  onChange={onSourceChange}
                  tone="light"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
