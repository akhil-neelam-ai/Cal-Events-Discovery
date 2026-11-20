import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { writeDayPages } from "./scripts/dayPages";

/**
 * Writes the plain-text day pages for AI assistants into public/days/ before
 * Vite copies public/. buildStart runs for `vite build` and when the dev
 * server starts, so the pages exist however the build is invoked.
 */
function dayPages(): Plugin {
  return {
    name: "calevents-day-pages",
    buildStart() {
      const { pages, largest } = writeDayPages(process.cwd());
      this.info(
        `day pages: ${pages.length} days, largest ${largest.toLocaleString()} characters`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), dayPages()],
  build: {
    // An explicit floor instead of esnext. It lowers syntax that Safari 15
    // cannot parse, and it keeps the -webkit- prefixes that Safari 17 and
    // earlier need for backdrop blur.
    target: "safari15",
  },
});
