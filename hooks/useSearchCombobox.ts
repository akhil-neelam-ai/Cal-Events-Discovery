import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { POPULAR_SEARCHES } from "../appConfig";

// No option is active until the user moves onto one with the arrow keys or
// the pointer. Enter then submits the typed query instead of silently
// replacing it with the first suggestion.
const NO_ACTIVE_OPTION = -1;

export function useSearchCombobox({
  isOpen,
  recents,
  onSelect,
  onClose,
}: {
  isOpen: boolean;
  recents: string[];
  onSelect: (query: string) => void;
  onClose: () => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(NO_ACTIVE_OPTION);
  const [wasOpen, setWasOpen] = useState(isOpen);

  // Each time the list opens or closes, start again with no active option.
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setActiveIndex(NO_ACTIVE_OPTION);
  }

  const suggestions = useMemo(
    () => [
      ...recents,
      ...POPULAR_SEARCHES.filter((item) => !recents.includes(item)),
    ],
    [recents],
  );

  const resolvedActiveIndex =
    isOpen && suggestions.length > 0 && activeIndex >= 0
      ? activeIndex % suggestions.length
      : NO_ACTIVE_OPTION;

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || suggestions.length === 0) {
        if (event.key === "Escape") {
          onClose();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) =>
          index < 0
            ? 0
            : ((index % suggestions.length) + 1) % suggestions.length,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => {
          const current = index < 0 ? 0 : index % suggestions.length;
          return (current - 1 + suggestions.length) % suggestions.length;
        });
      } else if (event.key === "Enter") {
        // With nothing active, let the input's own Enter handler submit the
        // typed query.
        if (resolvedActiveIndex < 0) {
          return;
        }
        event.preventDefault();
        onSelect(suggestions[resolvedActiveIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [isOpen, onClose, onSelect, resolvedActiveIndex, suggestions],
  );

  const getItemProps = useCallback(
    (index: number) => ({
      ref: (element: HTMLButtonElement | null) => {
        itemRefs.current[index] = element;
      },
      id: `search-suggestion-${index}`,
      role: "option" as const,
      "aria-selected": resolvedActiveIndex === index,
      onMouseEnter: () => setActiveIndex(index),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(suggestions[index]);
        }
      },
    }),
    [onSelect, resolvedActiveIndex, suggestions],
  );

  const activeDescendantId =
    resolvedActiveIndex >= 0
      ? `search-suggestion-${resolvedActiveIndex}`
      : undefined;

  return {
    suggestions,
    activeIndex: resolvedActiveIndex,
    activeDescendantId,
    handleInputKeyDown,
    getItemProps,
    suggestionCount: suggestions.length,
  };
}
