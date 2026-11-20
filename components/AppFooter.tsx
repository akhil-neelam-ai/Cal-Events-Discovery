export function AppFooter() {
  return (
    <footer className="foot">
      <p>
        CalEvents gathers UC Berkeley&apos;s public calendars every morning.
      </p>
      <p>
        Built for Berkeley students to discover campus events across all schools
        and organizations. By{" "}
        <a
          href="https://akhilneelam.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Akhil Neelam
        </a>
        , Haas MBA.
      </p>
      <p>
        Feedback? Reach out at{" "}
        <a href="mailto:akhil_neelam@berkeley.edu">akhil_neelam@berkeley.edu</a>
      </p>
      <p>
        Building an agent? See <a href="/for-agents.html">for agents</a>,{" "}
        <a href="/llms.txt">llms.txt</a>, and browser WebMCP tools on this page.
      </p>
      <p>
        This site counts visits and searches with analytics. Read the{" "}
        <a href="/privacy.html">privacy page</a> or{" "}
        <a href="/about.html">about CalEvents</a>.
      </p>
    </footer>
  );
}
