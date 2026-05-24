import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { POPULAR_SEARCHES } from "../appConfig";

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
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(
    () => [
      ...recents,
      ...POPULAR_SEARCHES.filter((item) => !recents.includes(item)),
    ],
    [recents],
  );

  const resolvedActiveIndex =
    isOpen && suggestions.length > 0
      ? ((activeIndex % suggestions.length) + suggestions.length) %
        suggestions.length
      : -1;

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
        setActiveIndex((index) => index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => index - 1);
      } else if (event.key === "Enter") {
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
