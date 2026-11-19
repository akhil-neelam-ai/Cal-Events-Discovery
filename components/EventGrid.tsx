import React, { type CSSProperties } from "react";

import { trackExternalLink } from "../utils/analytics";
import type { EventGroup } from "../utils/eventDates";
import {
  addDaysToDateKey,
  clockMinutes,
  formatMultiDayWhen,
} from "../utils/eventDates";
import {
  isHomeGame,
  isRecFacilitySchedule,
  shortenVenue,
} from "../utils/eventPresentation";
import {
  isWideSheet,
  paperColor,
  sheetTilt,
  titleSizeClass,
} from "../utils/flyerWall";
import { CalEvent, SearchFilters } from "../types";
import { RecHoursCard } from "./RecHoursCard";
import { SourceBadge } from "./SourceBadge";

// A day's Rec Sports schedules collapse into one row once there are two.
function splitRecSchedules(events: CalEvent[]) {
  const rec = events.filter(isRecFacilitySchedule);
  return rec.length >= 2
    ? { cards: events.filter((event) => !isRecFacilitySchedule(event)), rec }
    : { cards: events, rec: [] };
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** "7:00 PM" as a big clock and a small "PM". */
function splitClock(time: string): [string, string] | null {
  const match = time.match(/^\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)\s*$/i);
  return match ? [match[1], match[2].toUpperCase()] : null;
}

/** The time at the top of a sheet, and the run of a multi-day event. */
function SheetWhen({
  event,
  id,
  dateRange,
  todayKey,
}: {
  event: CalEvent;
  id: string;
  dateRange: SearchFilters["dateRange"];
  todayKey: string;
}) {
  const run = formatMultiDayWhen(event, undefined, dateRange, todayKey);
  const clock =
    clockMinutes(event.time) === null ? null : splitClock(event.time);
  return (
    <p id={id} className="when">
      {clock ? (
        <>
          {clock[0]}
          <small>{clock[1]}</small>
        </>
      ) : (
        <small className="allday">{event.time || "All day"}</small>
      )}
      {run && <small className="hours">{run}</small>}
    </p>
  );
}

function Sheet({
  event,
  index,
  dateRange,
  todayKey,
  onEventClick,
}: {
  event: CalEvent;
  index: number;
  dateRange: SearchFilters["dateRange"];
  todayKey: string;
  onEventClick: (event: CalEvent) => void;
}) {
  const whenId = `event-card-when-${index}`;
  const metaId = `event-card-meta-${index}`;
  const venue = shortenVenue(event.location);
  const away = event.source === "calbears" && !isHomeGame(event);

  return (
    <article
      className={`sheet${isWideSheet(event) ? " wide" : ""}`}
      style={
        {
          "--p": paperColor(event.tags?.[0]),
          "--r": `${sheetTilt(event.id || event.title)}deg`,
        } as CSSProperties
      }
    >
      <SheetWhen
        event={event}
        id={whenId}
        dateRange={dateRange}
        todayKey={todayKey}
      />
      <h4 className={`what ${titleSizeClass(event.title)}`}>
        {/* The title button covers the sheet, so a click anywhere opens the
            details. The source link stays a sibling above it. */}
        <button
          type="button"
          onClick={() => onEventClick(event)}
          aria-describedby={`${whenId} ${metaId}`}
          className="sheet-open"
        >
          {event.title}
        </button>
      </h4>
      <div id={metaId}>
        {venue && <p className="where">{venue}</p>}
        {event.organizer && !sameText(event.organizer, venue) && (
          <p className="who">{event.organizer}</p>
        )}
      </div>
      {away && <span className="perk">Away</span>}
      <div className="fine">
        <SourceBadge
          source={event.source}
          alsoListed={(event.also_listed ?? []).map(({ source }) => source)}
          linked={false}
        />
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              trackExternalLink({
                event_id: event.id,
                event_title: event.title,
                destination_url: event.url,
              });
            }}
            aria-label={`Open source page for ${event.title}`}
            className="sheet-link"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="square"
                strokeWidth={2.5}
                d="M10 6H5v13h13v-5M14 4h6v6m0-6L10 14"
              />
            </svg>
          </a>
        )}
      </div>
    </article>
  );
}

export function EventGrid({
  eventGroups,
  filteredEventsCount,
  visibleEventsCount,
  hiddenEventCount,
  effectiveDateRange,
  todayKey,
  onEventClick,
  onLoadMore,
}: {
  eventGroups: EventGroup[];
  filteredEventsCount: number;
  visibleEventsCount: number;
  hiddenEventCount: number;
  effectiveDateRange: SearchFilters["dateRange"];
  todayKey: string;
  onEventClick: (event: CalEvent) => void;
  onLoadMore: () => void;
}) {
  // Sheets show only the time, so chalk strips name the day. Only a
  // one-day range showing just that day can leave them out.
  const impliedDayKey =
    effectiveDateRange === "today"
      ? todayKey
      : effectiveDateRange === "tomorrow"
        ? addDaysToDateKey(todayKey, 1)
        : null;
  const showStrips =
    eventGroups.length > 1 ||
    (eventGroups.length === 1 && eventGroups[0].dateKey !== impliedDayKey);
  let globalIdx = 0;

  return (
    <>
      {eventGroups.map((group, groupIndex) => {
        const { cards, rec } = splitRecSchedules(group.events);
        return (
          <React.Fragment key={group.dateKey}>
            {showStrips && (
              <div className={`strip${groupIndex === 0 ? " beside" : ""}`}>
                <h3>{group.label}</h3>
                <p>
                  {group.events.length} event
                  {group.events.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
            {cards.map((event) => {
              const idx = globalIdx++;
              return (
                <Sheet
                  key={event.id || idx}
                  event={event}
                  index={idx}
                  dateRange={effectiveDateRange}
                  todayKey={todayKey}
                  onEventClick={onEventClick}
                />
              );
            })}
            {rec.length > 0 && (
              <RecHoursCard events={rec} onEventClick={onEventClick} />
            )}
          </React.Fragment>
        );
      })}
      <div className="more wall-full">
        <p>
          Showing {visibleEventsCount} of {filteredEventsCount} events
        </p>
        {hiddenEventCount > 0 ? (
          <button type="button" onClick={onLoadMore}>
            Load more events ({hiddenEventCount} remaining)
          </button>
        ) : (
          <p>All {filteredEventsCount} events loaded</p>
        )}
      </div>
    </>
  );
}
