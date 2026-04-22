export function AppFooter() {
  return (
    <footer className="bg-berkeley-blue text-white/70 py-6 mt-10">
      <div className="container mx-auto px-4 text-center text-sm">
        <p className="mb-1">
          Built for Berkeley students to discover campus events across all
          schools and organizations. By{" "}
          <a
            href="https://akhilneelam.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-berkeley-gold hover:underline font-medium"
          >
            Akhil Neelam
          </a>
          , <span className="text-berkeley-gold font-medium">Haas MBA</span>.
        </p>
        <p>
          Feedback? Reach out at{" "}
          <a
            href="mailto:akhil_neelam@berkeley.edu"
            className="text-berkeley-gold hover:underline"
          >
            akhil_neelam@berkeley.edu
          </a>
        </p>
      </div>
    </footer>
  );
}
