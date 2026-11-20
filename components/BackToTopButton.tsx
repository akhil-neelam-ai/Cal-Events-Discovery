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
      className="to-top"
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}
