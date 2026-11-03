import { useId, useState } from "react";

import { CalEvent } from "../types";
import { getCategoryStyle, shortenVenue } from "../utils/eventPresentation";
import { SourceBadge } from "./SourceBadge";

const PREVIEW_COUNT = 3;

function timeRange(event: CalEvent): string {
  return event.end_time ? `${event.time} – ${event.end_time}` : event.time;
}

/**
 * One row for a day's Recreational Sports schedules (building hours, open
 * rec, lap swim), which would otherwise fill the first screen. It opens to
 * list them, and each opens its own details.
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
  const style = getCategoryStyle("Sports");
  const names = [...new Set(events.map((event) => event.title))];
  const preview = names.slice(0, PREVIEW_COUNT).join(", ");
  const more = names.length - PREVIEW_COUNT;

  return (
    <article className="relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,50,98,0.06),0_4px_16px_rgba(0,50,98,0.05)]">
      <div
        className="absolute bottom-0 left-0 top-0 w-[3px] rounded-l-2xl"
        style={{
          background: `linear-gradient(to bottom, ${style.stripColor} 0%, transparent 100%)`,
        }}
      />
      <div className="p-5 pl-6">
        <span
          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${style.badge}`}
        >
          {style.label}
        </span>
        <h4 className="mt-3 font-serif text-[1.05rem] font-semibold leading-snug text-berkeley-blue">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold/60"
          >
            Rec facility hours
            <svg
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </h4>
        <p className="text-xs text-slate-500">
          {events.length} schedules: {preview}
          {more > 0 ? ` and ${more} more` : ""}
        </p>
        {open && (
          <ul id={listId} className="mt-3 divide-y divide-slate-100">
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onEventClick(event)}
                  className="flex min-h-11 w-full flex-col items-start py-2 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold/60"
                >
                  <span className="text-sm font-medium text-slate-700">
                    {event.title}
                  </span>
                  <span className="text-xs text-slate-500">
                    {timeRange(event)}
                    {event.location ? ` · ${shortenVenue(event.location)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        className="flex items-center px-6 py-3"
        style={{ borderTop: "1px solid rgba(0,50,98,0.06)" }}
      >
        <SourceBadge source={events[0]?.source} linked={false} />
      </div>
    </article>
  );
}
