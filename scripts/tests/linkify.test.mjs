import assert from "node:assert/strict";
import test from "node:test";

import { linkifySegments } from "../../utils/linkify.ts";

const links = (text) =>
  linkifySegments(text)
    .filter((segment) => segment.kind === "link")
    .map(({ text: label, href }) => [label, href]);

test("links a URL wrapped in parentheses with the next word glued on", () => {
  const text =
    "Donate HERE (https://give.berkeley.edu/fund/FU0742000)PARKING INFORMATION";

  assert.deepEqual(links(text), [
    [
      "https://give.berkeley.edu/fund/FU0742000",
      "https://give.berkeley.edu/fund/FU0742000",
    ],
  ]);
  assert.equal(
    linkifySegments(text)
      .map((segment) => segment.text)
      .join(""),
    text,
  );
});

test("drops trailing punctuation and links bare www addresses", () => {
  assert.deepEqual(
    links("See www.berkeley.edu/events. Then https://x.edu/a, ok"),
    [
      ["www.berkeley.edu/events", "https://www.berkeley.edu/events"],
      ["https://x.edu/a", "https://x.edu/a"],
    ],
  );
});

test("links emails, with or without a printed mailto prefix", () => {
  assert.deepEqual(
    links("contact pkala@berkeley.edu (mailto:pkala@berkeley.edu)."),
    [
      ["pkala@berkeley.edu", "mailto:pkala@berkeley.edu"],
      ["mailto:pkala@berkeley.edu", "mailto:pkala@berkeley.edu"],
    ],
  );
});

test("keeps an @ inside a URL as part of that URL", () => {
  assert.deepEqual(links("https://x.com/@calbears now"), [
    ["https://x.com/@calbears", "https://x.com/@calbears"],
  ]);
});

test("never builds a script or other non-web href", () => {
  for (const text of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "plain words only",
  ]) {
    assert.deepEqual(links(text), []);
  }
});
