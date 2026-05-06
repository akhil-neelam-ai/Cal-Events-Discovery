import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

export function BackToTopButton() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: prefersReducedMotion ? "auto" : "smooth",
        })
      }
      className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-berkeley-blue text-white shadow-md transition-opacity duration-200 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold/60 focus-visible:ring-offset-2"
    >
      ↑
    </button>
  );
}
