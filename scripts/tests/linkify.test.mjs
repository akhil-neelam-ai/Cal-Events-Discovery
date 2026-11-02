import assert from "node:assert/strict";
import test from "node:test";

import { displaySegments, linkifySegments } from "../../utils/linkify.ts";

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

const shown = (text) =>
  displaySegments(text)
    .map((segment) =>
      segment.kind === "link"
        ? `[${segment.text}](${segment.href})`
        : segment.text,
    )
    .join("");

test("display links the anchor words and drops the printed URL", () => {
  assert.equal(
    shown(
      "\u200BDesign Field Notes (https://x.edu/dfn?utm_source=luma) is a lecture series.",
    ),
    "\u200B[Design Field Notes](https://x.edu/dfn?utm_source=luma) is a lecture series.",
  );
  assert.equal(
    shown("Please click this Google Maps Link (https://maps.example/x) and go"),
    "Please click this [Google Maps Link](https://maps.example/x) and go",
  );
  assert.equal(
    shown("Visit the Center for Latin American Studies (https://x.edu)."),
    "Visit the [Center for Latin American Studies](https://x.edu).",
  );
  assert.equal(
    shown(
      "To watch visit music.berkeley.edu/watch (https://music.berkeley.edu/watch)",
    ),
    "To watch visit [music.berkeley.edu/watch](https://music.berkeley.edu/watch)",
  );
  assert.equal(
    shown("To attend, register here (https://x.edu/r) today"),
    "To attend, register [here](https://x.edu/r) today",
  );
});

test("display keeps a break where the source glued the next paragraph on", () => {
  assert.equal(
    shown(
      "donating online HERE (https://give.edu/f)PARKING INFORMATION (http://x.edu/p)Please note",
    ),
    "donating online [HERE](https://give.edu/f)\n[PARKING INFORMATION](http://x.edu/p)\nPlease note",
  );
});

test("display drops a printed mailto that repeats the linked address", () => {
  assert.equal(
    shown(
      "contact staff atjacobsinstitute@berkeley.edu (mailto:jacobsinstitute@berkeley.edu)with notice",
    ),
    "contact staff at [jacobsinstitute@berkeley.edu](mailto:jacobsinstitute@berkeley.edu) with notice",
  );
  assert.equal(
    shown("contact pkala@berkeley.edu (mailto:pkala@berkeley.edu) with notice"),
    "contact [pkala@berkeley.edu](mailto:pkala@berkeley.edu) with notice",
  );
});

test("display leaves bare URLs and anchorless parentheses as URL links", () => {
  assert.equal(
    shown("Details at https://x.edu/a today"),
    "Details at [https://x.edu/a](https://x.edu/a) today",
  );
  assert.equal(
    shown("See the notes. (https://x.edu/n)"),
    "See the notes. ([https://x.edu/n](https://x.edu/n))",
  );
});
