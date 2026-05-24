import { useCallback, useEffect, useRef, useState } from "react";

import type { SourceOption } from "../appConfig";

export function SourceDropdown({
  options,
  value,
  onChange,
  tone = "light",
}: {
  options: SourceOption[];
  value: string;
  onChange: (next: string) => void;
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const [panelPos, setPanelPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = options.findIndex((option) => option.value === value);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    setFocusIndex(-1);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const openMenu = useCallback(() => {
    setFocusIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) return;

    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const minWidth = 220;
      const width = Math.max(rect.width, minWidth);
      const maxLeft = window.innerWidth - width - 8;
      const left = Math.max(8, Math.min(rect.left, maxLeft));
      setPanelPos({ top: rect.bottom + 6, left, width });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu(true);
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      itemRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  const handleTriggerKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      openMenu();
    }
  };

  const pick = (next: string) => {
    onChange(next);
    closeMenu(true);
  };

  const handleItemKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = (index + 1) % options.length;
      setFocusIndex(next);
      itemRefs.current[next]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const previous = (index - 1 + options.length) % options.length;
      setFocusIndex(previous);
      itemRefs.current[previous]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocusIndex(0);
      itemRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const last = options.length - 1;
      setFocusIndex(last);
      itemRefs.current[last]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(options[index].value);
    } else if (event.key === "Tab") {
      closeMenu();
    }
  };

  const triggerClasses =
    tone === "dark"
      ? "inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition text-white"
      : "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKey}
        className={
          triggerClasses +
          " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
        }
      >
        <span className="font-medium">
          {selected.label}{" "}
          <span className="opacity-70">({selected.count})</span>
        </span>
        <svg
          aria-hidden="true"
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
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

      {open && panelPos && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label="Filter by source"
          style={{
            position: "fixed",
            top: panelPos.top,
            left: panelPos.left,
            width: panelPos.width,
            zIndex: 9999,
          }}
          className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 text-gray-800 shadow-2xl"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isAllOption = option.value === "All";
            return (
              <div key={option.value}>
                {index === 1 && (
                  <div className="mx-3 my-1.5 border-t border-slate-100" />
                )}
                <button
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => pick(option.value)}
                  onKeyDown={(event) => handleItemKey(event, index)}
                  onMouseEnter={() => setFocusIndex(index)}
                  className={`mx-1 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                    isSelected
                      ? "bg-berkeley-blue text-white"
                      : focusIndex === index
                        ? "bg-slate-100 text-berkeley-blue"
                        : "text-slate-700 hover:bg-slate-50"
                  } ${isAllOption ? "font-semibold" : ""}`}
                  style={{ width: "calc(100% - 8px)" }}
                >
                  <span className="truncate">{option.label}</span>
                  <span
                    className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {option.count}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
