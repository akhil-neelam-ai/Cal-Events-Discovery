import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStaleDataBannerMessage,
  shouldShowStaleDataBanner,
} from "../../utils/staleDataUi.ts";

test("shouldShowStaleDataBanner when age exceeds 12h or sources are degraded", () => {
  assert.equal(shouldShowStaleDataBanner(13, []), true);
  assert.equal(shouldShowStaleDataBanner(0, ["bampfa"]), true);
  assert.equal(shouldShowStaleDataBanner(8, []), false);
});

test("formatStaleDataBannerMessage lists degraded sources", () => {
  assert.match(
    formatStaleDataBannerMessage(18, ["cal_performances", "bampfa"]),
    /18h ago — Cal Performances and BAMPFA temporarily unavailable\./,
  );
});
