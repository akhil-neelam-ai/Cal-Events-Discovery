import { useEffect, useRef, useState } from "react";

export function useBackToTopVisibility(threshold = 800) {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const visibleRef = useRef(showBackToTop);

  useEffect(() => {
    let frameId: number | null = null;

    const updateVisibility = () => {
      frameId = null;
      const nextVisible = window.scrollY > threshold;
      if (visibleRef.current !== nextVisible) {
        visibleRef.current = nextVisible;
        setShowBackToTop(nextVisible);
      }
    };

    const handleScroll = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateVisibility);
    };

    updateVisibility();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [threshold]);

  return showBackToTop;
}
