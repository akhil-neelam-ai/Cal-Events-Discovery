import React from "react";

import { trackExternalLink } from "../utils/analytics";
import type { EventGroup } from "../utils/eventDates";
import { formatEventDate } from "../utils/eventDates";
import { getCategoryStyle, isHomeGame } from "../utils/eventPresentation";
import { CalEvent, SearchFilters } from "../types";
import { SourceBadge } from "./SourceBadge";

export function EventGrid({
  eventGroups,
  filteredEventsCount,
  visibleEventsCount,
  hiddenEventCount,
  shouldAnimateCards,
  effectiveDateRange,
  onEventClick,
  onLoadMore,
}: {
  eventGroups: EventGroup[];
  filteredEventsCount: number;
  visibleEventsCount: number;
  hiddenEventCount: number;
  shouldAnimateCards: boolean;
  effectiveDateRange: SearchFilters["dateRange"];
  onEventClick: (event: CalEvent) => void;
  onLoadMore: () => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {(() => {
          let globalIdx = 0;
          return eventGroups.map((group) => (
            <React.Fragment key={group.dateKey}>
              {eventGroups.length > 1 && (
                <div className="col-span-full flex items-center gap-3 pb-1 pt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {group.label}
                  </h3>
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs text-gray-400">
                    {group.events.length} event
                    {group.events.length !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {group.events.map((event) => {
                const idx = globalIdx++;
                const categoryStyle = getCategoryStyle(event.tags?.[0]);

                return (
                  <article
                    key={event.id || idx}
                    aria-label={event.title}
                    className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl bg-white select-none will-change-transform ${shouldAnimateCards ? "animate-card-in opacity-0" : ""}`}
                    style={{
                      boxShadow:
                        "0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)",
                      transition:
                        "transform 150ms cubic-bezier(0.32, 0.72, 0, 1), box-shadow 150ms cubic-bezier(0.32, 0.72, 0, 1)",
                      ...(shouldAnimateCards
                        ? {
                            animationDelay: `${Math.min(idx * 50, 500)}ms`,
                            animationFillMode: "forwards",
                          }
                        : {}),
                    }}
                    onClick={() => onEventClick(event)}
                    onMouseEnter={(mouseEvent) => {
                      (
                        mouseEvent.currentTarget as HTMLElement
                      ).style.boxShadow =
                        "0 8px 32px rgba(0,50,98,0.13), 0 1px 4px rgba(0,50,98,0.06)";
                      (
                        mouseEvent.currentTarget as HTMLElement
                      ).style.transform = "translateY(-3px)";
                    }}
                    onMouseLeave={(mouseEvent) => {
                      (
                        mouseEvent.currentTarget as HTMLElement
                      ).style.boxShadow =
                        "0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)";
                      (
                        mouseEvent.currentTarget as HTMLElement
                      ).style.transform = "";
                    }}
                    onTouchStart={(touchEvent) => {
                      (
                        touchEvent.currentTarget as HTMLElement
                      ).style.transform = "scale(0.975)";
                      (
                        touchEvent.currentTarget as HTMLElement
                      ).style.boxShadow = "0 1px 6px rgba(0,50,98,0.08)";
                    }}
                    onTouchEnd={(touchEvent) => {
                      (
                        touchEvent.currentTarget as HTMLElement
                      ).style.transform = "";
                      (
                        touchEvent.currentTarget as HTMLElement
                      ).style.boxShadow =
                        "0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)";
                    }}
                    onTouchCancel={(touchEvent) => {
                      (
                        touchEvent.currentTarget as HTMLElement
                      ).style.transform = "";
                      (
                        touchEvent.currentTarget as HTMLElement
                      ).style.boxShadow =
                        "0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)";
                    }}
                  >
                    <div
                      className="absolute bottom-0 left-0 top-0 w-[3px] rounded-l-2xl"
                      style={{
                        background: `linear-gradient(to bottom, ${categoryStyle.stripColor} 0%, transparent 100%)`,
                      }}
                    />

                    <div
                      className={`flex-grow p-5 pl-6 ${categoryStyle.tintBg}`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${categoryStyle.badge}`}
                        >
                          {event.tags?.[0] || "Event"}
                        </span>
                        {event.source === "calbears" && !isHomeGame(event) && (
                          <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                            Away
                          </span>
                        )}
                        {event.url && (
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(eventClick) => {
                              eventClick.stopPropagation();
                              trackExternalLink({
                                event_id: event.id,
                                event_title: event.title,
                                destination_url: event.url,
                              });
                            }}
                            aria-label={`Open source page for ${event.title}`}
                            className="flex-shrink-0 rounded-full p-1.5 text-slate-300 transition hover:bg-white/80 hover:text-berkeley-blue"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </a>
                        )}
                      </div>

                      <h3
                        className="mb-4 text-[1.05rem] font-semibold leading-snug text-berkeley-blue transition-colors group-hover:text-berkeley-medblue md:font-serif"
                        style={{ letterSpacing: "-0.01em" }}
                      >
                        {event.title}
                      </h3>

                      <div className="space-y-1.5 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <svg
                            className="h-3.5 w-3.5 flex-shrink-0 text-[#FDB515]"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                          <span className="font-medium text-slate-700">
                            {effectiveDateRange !== "today" &&
                              `${formatEventDate(event.date)} · `}
                            {event.time || "All day"}
                          </span>
                          {event.location && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="truncate">{event.location}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <svg
                            className="h-3.5 w-3.5 flex-shrink-0 text-[#FDB515]"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                          </svg>
                          <span
                            className="truncate italic text-slate-500"
                            title={event.organizer}
                          >
                            {event.organizer}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div
                      className="flex items-center justify-between px-6 py-3"
                      style={{ borderTop: "1px solid rgba(0,50,98,0.06)" }}
                    >
                      <SourceBadge source={event.source} linked={false} />
                      <button
                        type="button"
                        onClick={(eventClick) => {
                          eventClick.stopPropagation();
                          onEventClick(event);
                        }}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-berkeley-blue transition-colors hover:text-berkeley-medblue focus:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold/60"
                      >
                        View details
                        <svg
                          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    </div>
                  </article>
                );
              })}
            </React.Fragment>
          ));
        })()}
      </div>
      <div className="mt-6 flex flex-col items-center gap-3">
        <p className="text-center text-sm text-gray-400">
          Showing {visibleEventsCount} of {filteredEventsCount} events
        </p>
        {hiddenEventCount > 0 ? (
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors duration-200 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold/60 focus-visible:ring-offset-2"
          >
            Load more events ({hiddenEventCount} remaining)
          </button>
        ) : (
          <p className="text-center text-sm text-gray-400">
            All {filteredEventsCount} events loaded
          </p>
        )}
      </div>
    </>
  );
}
