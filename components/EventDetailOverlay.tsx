import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { trackExternalLink } from "../utils/analytics";
import {
  formatEventDate,
  formatMultiDayWhen,
  isContiguousRun,
} from "../utils/eventDates";
import { addEventToCalendar } from "../utils/icsExport";
import {
  getDirectionsUrl,
  hasDistinctDescription,
} from "../utils/eventPresentation";
import { categoryLabel, paperColor, titleSizeClass } from "../utils/flyerWall";
import { displaySegments } from "../utils/linkify";
import { useDialogAccessibility } from "../hooks/useDialogAccessibility";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { CalEvent } from "../types";
import { SOURCE_LABELS } from "../appConfig";
import { SourceBadge } from "./SourceBadge";

// Matches the closing transition on .flyer-layer.closing in index.css.
const CLOSE_MS = 180;
// A pull this far down on the flyer's top edge closes it on a phone.
const DRAG_CLOSE_PX = 150;

/** "Also listed on Cal Bears", linking to each other source's own page. */
function AlsoListed({ event }: { event: CalEvent }) {
  const listings = (event.also_listed ?? []).filter(
    ({ source }) => SOURCE_LABELS[source],
  );
  if (listings.length === 0) return null;
  return (
    <>
      {" "}
      Also listed on{" "}
      {listings.map(({ source, url }, index) => (
        <React.Fragment key={source}>
          {index > 0 && (index === listings.length - 1 ? " and " : ", ")}
          <a href={url} target="_blank" rel="noopener noreferrer">
            {SOURCE_LABELS[source]}
          </a>
        </React.Fragment>
      ))}
      .
    </>
  );
}

/**
 * Plain feed text with tappable links. A printed "anchor (url)" shows as the
 * linked anchor words, the way the source page shows it.
 */
function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {displaySegments(text).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={index}
            href={segment.href}
            title={segment.text === segment.href ? undefined : segment.href}
            target={segment.href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noopener noreferrer"
          >
            {segment.text}
          </a>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/** Bold date line: a span for multi-day events, else the date. */
function detailWhenPrimary(event: CalEvent): string {
  return formatMultiDayWhen(event) ?? formatEventDate(event.date);
}

/** "7:00 to 9:00 PM", or "11:00 AM to 1:00 PM" across noon. */
function timeSpan(start: string, end: string): string {
  const startMatch = start.match(/^(.*\d)\s*(AM|PM)$/i);
  const endMatch = end.match(/(AM|PM)$/i);
  if (
    startMatch &&
    endMatch &&
    startMatch[2].toUpperCase() === endMatch[1].toUpperCase()
  ) {
    return `${startMatch[1]} to ${end}`;
  }
  return `${start} to ${end}`;
}

/** Secondary line: recurrence descriptor for multi-day events, else the time. */
function detailWhenSecondary(event: CalEvent): string {
  if (event.dates && event.dates.length > 1) {
    if (isContiguousRun(event.dates)) {
      return event.time === "All day"
        ? "Daily · all day"
        : `Daily · ${event.time}`;
    }
    return `${event.dates.length} dates`;
  }
  if (event.end_time && event.time && event.time !== "All day") {
    return timeSpan(event.time, event.end_time);
  }
  return event.time;
}

/**
 * The tear on a tear-off tab. A tap runs the action at once. Where motion
 * is allowed, a copy of the tab falls away while the tab itself stays, so
 * it works again on the next tap.
 */
function useTear(label: string, prefersReducedMotion: boolean) {
  // The falling copy keeps the label it had when torn.
  const [torn, setTorn] = useState<{ count: number; label: string } | null>(
    null,
  );
  const tear = () => {
    if (prefersReducedMotion) return;
    setTorn((previous) => ({ count: (previous?.count ?? 0) + 1, label }));
  };
  const ghost = torn ? (
    <span
      key={torn.count}
      aria-hidden="true"
      className="tear-ghost"
      onAnimationEnd={() => setTorn(null)}
    >
      <span className="tear-label">{torn.label}</span>
    </span>
  ) : null;
  return [tear, ghost] as const;
}

function TearTabs({
  event,
  directionsUrl,
  preferGoogleCalendar,
}: {
  event: CalEvent;
  directionsUrl: string | null;
  preferGoogleCalendar: boolean;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const showCopyState = useCallback((state: "copied" | "failed") => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    setCopyState(state);
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimeoutRef.current = null;
    }, 2000);
  }, []);

  const handleCopyLink = useCallback(() => {
    if (!navigator.clipboard) {
      showCopyState("failed");
      return;
    }

    void navigator.clipboard
      .writeText(window.location.href)
      .then(() => showCopyState("copied"))
      .catch(() => {
        showCopyState("failed");
      });
  }, [showCopyState]);

  const calendarLabel = preferGoogleCalendar
    ? "Add to Google Calendar"
    : "Add to Calendar";
  const copyLabel =
    copyState === "copied"
      ? "Copied!"
      : copyState === "failed"
        ? "Copy failed"
        : "Copy link";

  const prefersReducedMotion = usePrefersReducedMotion();
  const calendarText = preferGoogleCalendar
    ? "Add to Google Calendar"
    : "Add to calendar";
  const [tearOfficial, officialGhost] = useTear(
    "View official page",
    prefersReducedMotion,
  );
  const [tearDirections, directionsGhost] = useTear(
    "Directions",
    prefersReducedMotion,
  );
  const [tearCalendar, calendarGhost] = useTear(
    calendarText,
    prefersReducedMotion,
  );
  const [tearCopy, copyGhost] = useTear(copyLabel, prefersReducedMotion);

  return (
    <div className="tear">
      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View Official Page"
          onClick={() => {
            tearOfficial();
            trackExternalLink({
              event_id: event.id,
              event_title: event.title,
              destination_url: event.url,
            });
          }}
        >
          <span className="tear-label">View official page</span>
          {officialGhost}
        </a>
      )}
      {directionsUrl && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Map & Directions"
          onClick={(eventClick) => {
            eventClick.stopPropagation();
            tearDirections();
            trackExternalLink({
              event_id: event.id,
              event_title: event.title,
              destination_url: directionsUrl,
            });
          }}
        >
          <span className="tear-label">Directions</span>
          {directionsGhost}
        </a>
      )}
      <button
        type="button"
        aria-label={calendarLabel}
        onClick={() => {
          tearCalendar();
          addEventToCalendar(event, { preferGoogle: preferGoogleCalendar });
        }}
      >
        <span className="tear-label">{calendarText}</span>
        {calendarGhost}
      </button>
      <button
        type="button"
        onClick={() => {
          tearCopy();
          handleCopyLink();
        }}
      >
        <span className="tear-label">{copyLabel}</span>
        {copyGhost}
      </button>
    </div>
  );
}

/**
 * One flyer pulled off the wall: the event in its category's paper, with
 * tear-off tabs for its actions, and the description on a plain sheet
 * stapled underneath. The same flyer serves phones and desktops.
 */
export function EventDetailOverlay({
  event,
  isMobile,
  onClose,
}: {
  event: CalEvent;
  isMobile: boolean;
  onClose: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const touchStartYRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const category = event.tags?.[0];
  const directionsUrl = getDirectionsUrl(event.location);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    closeTimeoutRef.current = window.setTimeout(
      onClose,
      prefersReducedMotion ? 0 : CLOSE_MS,
    );
  }, [onClose, prefersReducedMotion]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useDialogAccessibility({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: handleClose,
  });

  return (
    <div className={`flyer-layer${isClosing ? " closing" : ""}`}>
      <div
        aria-hidden="true"
        className="flyer-backdrop"
        onClick={handleClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flyer-dialog"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        <div
          className="flyer"
          style={{ "--p": paperColor(category) } as CSSProperties}
        >
          {/* The staple edge. On a phone, pulling it down closes the flyer. */}
          <div
            className="flyer-grip"
            aria-hidden="true"
            onTouchStart={(eventTouch) => {
              touchStartYRef.current = eventTouch.touches[0].clientY;
            }}
            onTouchMove={(eventTouch) => {
              if (touchStartYRef.current === null) return;
              const deltaY =
                eventTouch.touches[0].clientY - touchStartYRef.current;
              setDragY(Math.max(deltaY, 0));
            }}
            onTouchEnd={() => {
              touchStartYRef.current = null;
              if (dragY > DRAG_CLOSE_PX) {
                handleClose();
              }
              setDragY(0);
            }}
          />
          <div className="flyer-body">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              aria-label="Close event details"
              className="flyer-close"
            >
              Back to the wall
            </button>
            <p className="d-when">
              <span>{detailWhenPrimary(event)}</span>,{" "}
              <span>{detailWhenSecondary(event)}</span>
            </p>
            <h2
              id={titleId}
              className={`d-what ${titleSizeClass(event.title)}`}
            >
              {event.title}
            </h2>
            {event.location && (
              <p className="d-where">
                <LinkifiedText text={event.location} />
              </p>
            )}
            <p className="d-who">
              {event.organizer ? `${event.organizer.replace(/\.$/, "")}. ` : ""}
              Filed under {categoryLabel(category)}.
            </p>
            {SOURCE_LABELS[event.source] && (
              <p className="d-from">
                From <SourceBadge source={event.source} />.
                <AlsoListed event={event} />
              </p>
            )}
          </div>
          {/* Actions come before the description, which can run very long. */}
          <TearTabs
            event={event}
            directionsUrl={directionsUrl}
            preferGoogleCalendar={!isMobile}
          />
        </div>

        {hasDistinctDescription(event) && (
          <div className="flyer-notes">
            <h3>About this event</h3>
            <p className="d-desc">
              <LinkifiedText text={event.description} />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
