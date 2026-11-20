import { useId, useState, type CSSProperties } from "react";

import { CalEvent } from "../types";
import { shortenVenue } from "../utils/eventPresentation";
import { SourceBadge } from "./SourceBadge";

const PREVIEW_COUNT = 3;

function timeRange(event: CalEvent): string {
  return event.end_time ? `${event.time} to ${event.end_time}` : event.time;
}

/**
 * One plain sheet for a day's Recreational Sports schedules (building hours,
 * open rec, lap swim), which would otherwise fill the first screen. It opens
 * to list them, and each opens its own details.
 */
export function RecHoursCard({
  events,
  onEventClick,
}: {
  events: CalEvent[];
  onEventClick: (event: CalEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const names = [...new Set(events.map((event) => event.title))];
  const preview = names.slice(0, PREVIEW_COUNT).join(", ");
  const more = names.length - PREVIEW_COUNT;

  return (
    <article className="sheet" style={{ "--r": "0.4deg" } as CSSProperties}>
      <h4 className="what s2 w-full">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="rec-toggle"
        >
          Rec facility hours
          <svg
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="square" strokeWidth={3} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </h4>
      <p className="where">
        {events.length} schedules: {preview}
        {more > 0 ? ` and ${more} more` : ""}
      </p>
      {open && (
        <ul id={listId} className="rec-list">
          {events.map((event) => (
            <li key={event.id}>
              <button type="button" onClick={() => onEventClick(event)}>
                <b>{event.title}</b>
                <span>
                  {timeRange(event)}
                  {event.location ? `, ${shortenVenue(event.location)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="fine">
        <SourceBadge source={events[0]?.source} linked={false} />
      </div>
    </article>
  );
}
