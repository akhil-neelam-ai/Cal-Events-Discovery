import { useCallback, useEffect, useRef, useState } from "react";

import type { SourceOption } from "../appConfig";

export function SourceDropdown({
  options,
  value,
  onChange,
}: {
  options: SourceOption[];
  value: string;
  onChange: (next: string) => void;
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

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKey}
        className="scrap"
      >
        <span>
          {selected.label} <span className="count">({selected.count})</span>
        </span>
        <svg
          aria-hidden="true"
          className={`h-3 w-3 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
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
          className="slip max-h-[60vh] py-1.5"
        >
          {options.map((option, index) => (
            <div key={option.value}>
              {index === 1 && (
                <div className="mx-3 my-1.5 border-t-2 border-dashed border-toner" />
              )}
              <button
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={option.value === value}
                data-active={focusIndex === index}
                onClick={() => pick(option.value)}
                onKeyDown={(event) => handleItemKey(event, index)}
                onMouseEnter={() => setFocusIndex(index)}
                className="slip-row"
              >
                <span className="truncate">{option.label}</span>
                <span className="count">{option.count}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
