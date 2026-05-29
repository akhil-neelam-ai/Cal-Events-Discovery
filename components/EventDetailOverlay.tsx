import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import { trackExternalLink } from "../utils/analytics";
import {
  formatEventDate,
  formatMultiDayWhen,
  isContiguousRun,
} from "../utils/eventDates";
import { downloadEventIcs } from "../utils/icsExport";
import { getCategoryStyle, getDirectionsUrl } from "../utils/eventPresentation";
import { useDialogAccessibility } from "../hooks/useDialogAccessibility";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { CalEvent } from "../types";
import { SourceBadge } from "./SourceBadge";

/** Bold date line for the detail panel: a span for multi-day events, else the date. */
function detailWhenPrimary(event: CalEvent): string {
  return formatMultiDayWhen(event) ?? formatEventDate(event.date);
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
  return event.time;
}

function DetailActions({
  event,
  directionsUrl,
  compact = false,
}: {
  event: CalEvent;
  directionsUrl: string | null;
  compact?: boolean;
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

  const handleAddToCalendar = useCallback(() => {
    downloadEventIcs(event);
  }, [event]);

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

  const copied = copyState === "copied";
  const copyLabel =
    copyState === "copied"
      ? "Copied!"
      : copyState === "failed"
        ? "Copy failed"
        : "Copy link";

  return compact ? (
    <div className="space-y-3">
      <div className="flex gap-2">
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block flex-1 select-none rounded-xl bg-berkeley-blue py-3.5 text-center font-bold text-white tap-highlight"
            style={{
              transition:
                "transform 150ms cubic-bezier(0.32,0.72,0,1), opacity 150ms ease",
            }}
            onClick={() =>
              trackExternalLink({
                event_id: event.id,
                event_title: event.title,
                destination_url: event.url,
              })
            }
          >
            View Official Page
          </a>
        )}
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-3.5 font-semibold text-slate-700 tap-highlight active:bg-slate-50 select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
          style={{ transition: "background-color 150ms ease" }}
          onClick={handleAddToCalendar}
        >
          Add to Calendar
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-3.5 font-semibold text-slate-700 tap-highlight active:bg-slate-50 select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
          style={{ transition: "background-color 150ms ease" }}
          onClick={handleCopyLink}
        >
          {copied ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-green-600"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          )}
          <span>{copyLabel}</span>
        </button>
      </div>
      {directionsUrl && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full select-none rounded-xl border border-slate-200 py-3.5 text-center font-semibold text-slate-700 tap-highlight active:bg-slate-50"
          style={{
            transition:
              "transform 150ms cubic-bezier(0.32,0.72,0,1), background-color 150ms ease",
          }}
          onClick={(eventClick) => {
            eventClick.stopPropagation();
            trackExternalLink({
              event_id: event.id,
              event_title: event.title,
              destination_url: directionsUrl,
            });
          }}
        >
          Map & Directions
        </a>
      )}
    </div>
  ) : (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-3.5 font-semibold text-slate-700 tap-highlight active:bg-slate-50 select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
        style={{ transition: "background-color 150ms ease" }}
        onClick={handleAddToCalendar}
      >
        Add to Calendar
      </button>
      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full select-none rounded-xl bg-berkeley-blue py-3.5 text-center font-bold text-white tap-highlight"
          style={{
            transition:
              "transform 150ms cubic-bezier(0.32,0.72,0,1), opacity 150ms ease",
          }}
          onClick={() =>
            trackExternalLink({
              event_id: event.id,
              event_title: event.title,
              destination_url: event.url,
            })
          }
        >
          View Official Page
        </a>
      )}
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-3.5 font-semibold text-slate-700 tap-highlight active:bg-slate-50 select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
        style={{ transition: "background-color 150ms ease" }}
        onClick={handleCopyLink}
      >
        {copied ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-green-600"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        )}
        <span>{copyLabel}</span>
      </button>
      {directionsUrl && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full select-none rounded-xl border border-slate-200 py-3.5 text-center font-semibold text-slate-700 tap-highlight active:bg-slate-50"
          style={{
            transition:
              "transform 150ms cubic-bezier(0.32,0.72,0,1), background-color 150ms ease",
          }}
          onClick={(eventClick) => {
            eventClick.stopPropagation();
            trackExternalLink({
              event_id: event.id,
              event_title: event.title,
              destination_url: directionsUrl,
            });
          }}
        >
          Map & Directions
        </a>
      )}
    </div>
  );
}

function BottomSheet({
  event,
  onClose,
}: {
  event: CalEvent;
  onClose: () => void;
}) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [touchStartY, setTouchStartY] = useState(0);
  const categoryStyle = getCategoryStyle(event.tags?.[0]);
  const directionsUrl = getDirectionsUrl(event.location);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();

  const handleClose = useCallback(() => {
    setIsClosing((previous) => {
      if (previous) {
        return previous;
      }

      closeTimeoutRef.current = window.setTimeout(
        onClose,
        prefersReducedMotion ? 0 : 300,
      );
      return true;
    });
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
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-black/40 backdrop-blur-[3px] ${prefersReducedMotion ? "" : `transition-opacity duration-300 ${isClosing ? "opacity-0" : "animate-fade-in"}`}`}
        onClick={handleClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-hidden rounded-t-3xl bg-white shadow-2xl overscroll-contain ${prefersReducedMotion || isClosing ? "" : "animate-slide-up"}`}
        style={{
          transform: isClosing ? "translateY(100%)" : `translateY(${dragY}px)`,
          transition:
            isDragging || prefersReducedMotion
              ? "none"
              : "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease-out",
        }}
      >
        <div
          className="flex cursor-grab justify-center pb-2 pt-3 active:cursor-grabbing"
          onTouchStart={(eventTouch) => {
            setIsDragging(true);
            setTouchStartY(eventTouch.touches[0].clientY);
          }}
          onTouchMove={(eventTouch) => {
            if (!isDragging) return;
            const deltaY = eventTouch.touches[0].clientY - touchStartY;
            if (deltaY > 0) setDragY(deltaY);
          }}
          onTouchEnd={() => {
            setIsDragging(false);
            if (dragY > 150) {
              handleClose();
            }
            setDragY(0);
          }}
        >
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="max-h-[calc(85vh-40px)] overflow-y-auto overscroll-contain px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="mb-3 flex items-center justify-between">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${categoryStyle.badge}`}
            >
              {categoryStyle.label}
            </span>
            <div className="flex items-center gap-3">
              <SourceBadge source={event.source} />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleClose}
                aria-label="Close event details"
                className="rounded-full border border-slate-200 p-3.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold/60 focus-visible:ring-offset-2"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          <h2
            id={titleId}
            className="mb-4 text-xl font-semibold text-berkeley-blue md:font-serif"
          >
            {event.title}
          </h2>

          <div className="mb-6 space-y-3 text-sm text-gray-600">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-berkeley-gold/10 p-2">
                <svg
                  className="h-4 w-4 text-berkeley-gold"
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
              </div>
              <div>
                <div className="font-bold text-gray-800">
                  {detailWhenPrimary(event)}
                </div>
                <div className="text-gray-500">
                  {detailWhenSecondary(event)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-berkeley-gold/10 p-2">
                <svg
                  className="h-4 w-4 text-berkeley-gold"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                </svg>
              </div>
              <div className="font-medium">{event.location}</div>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-berkeley-gold/10 p-2">
                <svg
                  className="h-4 w-4 text-berkeley-gold"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              </div>
              <div className="italic">{event.organizer}</div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="mb-2 font-bold text-gray-800">About this event</h3>
            <p className="whitespace-pre-wrap leading-relaxed text-gray-600">
              {event.description}
            </p>
          </div>

          <DetailActions event={event} directionsUrl={directionsUrl} compact />
        </div>
      </div>
    </div>
  );
}

function SlideOutPanel({
  event,
  onClose,
}: {
  event: CalEvent;
  onClose: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const categoryStyle = getCategoryStyle(event.tags?.[0]);
  const directionsUrl = getDirectionsUrl(event.location);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();

  const handleClose = useCallback(() => {
    setIsClosing((previous) => {
      if (previous) {
        return previous;
      }

      closeTimeoutRef.current = window.setTimeout(
        onClose,
        prefersReducedMotion ? 0 : 350,
      );
      return true;
    });
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
    <div className="fixed inset-0 z-50 hidden md:block">
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-black/40 backdrop-blur-xs ${prefersReducedMotion ? "" : `transition-opacity duration-300 ${isClosing ? "opacity-0" : "animate-fade-in"}`}`}
        onClick={handleClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute right-0 top-0 h-full w-[min(450px,90vw)] overflow-hidden bg-white shadow-2xl overscroll-contain ${prefersReducedMotion || isClosing ? "" : "animate-slide-in"}`}
        style={{
          boxShadow: "-10px 0 40px rgba(0,0,0,0.15)",
          transform: isClosing ? "translateX(100%)" : "translateX(0)",
          transition: prefersReducedMotion
            ? "none"
            : "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        <div className="flex items-center justify-between border-b border-gray-100 bg-berkeley-blue px-6 py-4 text-white">
          <span className="font-bold">Event Details</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label="Close event details"
            className="rounded-sm p-1 transition hover:bg-white/20"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="h-[calc(100%-60px)] overflow-y-auto overscroll-contain p-6">
          <div className="mb-3 flex items-center justify-between">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${categoryStyle.badge}`}
            >
              {categoryStyle.label}
            </span>
            <SourceBadge source={event.source} />
          </div>

          <h2
            id={titleId}
            className="mb-6 text-2xl font-semibold text-berkeley-blue md:font-serif"
          >
            {event.title}
          </h2>

          <div className="mb-8 space-y-4 text-sm text-gray-600">
            <div className="flex items-start gap-4 rounded-lg bg-gray-50 p-3">
              <div className="rounded-lg bg-berkeley-gold/10 p-2">
                <svg
                  className="h-5 w-5 text-berkeley-gold"
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
              </div>
              <div>
                <div className="text-base font-bold text-gray-800">
                  {formatEventDate(event.date)}
                </div>
                <div className="text-gray-500">{event.time}</div>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-lg bg-gray-50 p-3">
              <div className="rounded-lg bg-berkeley-gold/10 p-2">
                <svg
                  className="h-5 w-5 text-berkeley-gold"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                </svg>
              </div>
              <div className="text-base font-medium">{event.location}</div>
            </div>

            <div className="flex items-start gap-4 rounded-lg bg-gray-50 p-3">
              <div className="rounded-lg bg-berkeley-gold/10 p-2">
                <svg
                  className="h-5 w-5 text-berkeley-gold"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              </div>
              <div className="text-base italic">{event.organizer}</div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="mb-3 text-lg font-bold text-gray-800">
              About this event
            </h3>
            <p className="whitespace-pre-wrap leading-relaxed text-gray-600">
              {event.description}
            </p>
          </div>

          <DetailActions event={event} directionsUrl={directionsUrl} />
        </div>
      </div>
    </div>
  );
}

export function EventDetailOverlay({
  event,
  isMobile,
  onClose,
}: {
  event: CalEvent;
  isMobile: boolean;
  onClose: () => void;
}) {
  return isMobile ? (
    <BottomSheet event={event} onClose={onClose} />
  ) : (
    <SlideOutPanel event={event} onClose={onClose} />
  );
}
