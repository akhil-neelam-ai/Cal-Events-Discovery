import assert from "node:assert/strict";
import test from "node:test";

import { isoDateInPT } from "../../scripts/lib/normalize.ts";
import {
  mapTalkToCanonical,
  normalizeEventDate,
  parseEventTime,
  parseSpeakerEventsScript,
  ptDateTimeToIso,
  talkTitleFor,
} from "../../scripts/sources/ai_risk.ts";

const SAMPLE_SCRIPT = `
const speakerEvents = [
    {
        id: 3,
        speakerName: "Bharat Chandar",
        speakerAffiliation: "Stanford University",
        speakerWebsite: "https://bharatchandar.com",
        talkTitle: "Canaries in the Coal Mine",
        talkAbstract: "Line one\\nLine two",
        eventDate: "2025-10-7",
        eventTime: "16:30",
        eventLocation: "621 Sutardja Dai Hall",
        eventLink: "",
        videoUrl: "https://www.youtube.com/watch?v=abc",
        slidesUrl: "slides/chandar-slides.pdf"
    },
    {
        id: 6,
        speakerName: "Jessica Newman",
        speakerAffiliation: "UC Berkeley",
        speakerWebsite: "",
        talkTitle: "Can we Manage the Risks of Frontier AI?",
        talkAbstract: "",
        eventDate: "2025-11-18",
        eventTime: "16:30",
        eventLocation: "Zoom only",
        eventLink: "https://berkeley.zoom.us/j/123",
        videoUrl: "",
        slidesUrl: ""
    },
    {
        id: 9,
        speakerName: "Deirdre Mulligan",
        speakerAffiliation: "UC Berkeley",
        speakerWebsite: "",
        talkTitle: '"If anyone builds it, everyone dies": Sociotechnical Imaginaries',
        talkAbstract: "Joint work.",
        eventDate: "2026-02-03",
        eventTime: "16:00",
        eventLocation: "621 Sutardja Dai Hall",
        eventLink: "",
        videoUrl: "",
        slidesUrl: ""
    },
    {
        id: 16,
        speakerName: "John Sherman",
        speakerAffiliation: "UC Berkeley",
        speakerWebsite: "",
        talkTitle: "TBA",
        talkAbstract: "",
        eventDate: "2026-09-22",
        eventTime: "16:00",
        eventLocation: "621 Sutardja Dai Hall",
        eventLink: "",
        videoUrl: "",
        slidesUrl: ""
    },
];
function createEventHTML(event) { return event.talkTitle; }
`;

test("normalizeEventDate pads single-digit month and day", () => {
  assert.equal(normalizeEventDate("2025-10-7"), "2025-10-07");
  assert.equal(normalizeEventDate("2026-09-08"), "2026-09-08");
  assert.equal(normalizeEventDate("not-a-date"), null);
  assert.equal(normalizeEventDate("2026-13-01"), null);
});

test("parseEventTime accepts 24-hour HH:MM", () => {
  assert.deepEqual(parseEventTime("16:30"), { hour: 16, minute: 30 });
  assert.equal(parseEventTime("25:00"), null);
  assert.equal(parseEventTime("4:00 PM"), null);
});

test("ptDateTimeToIso uses Pacific DST offset", () => {
  assert.equal(
    ptDateTimeToIso("2026-01-15", 16, 0),
    "2026-01-15T16:00:00-08:00",
  );
  assert.equal(
    ptDateTimeToIso("2026-07-15", 16, 0),
    "2026-07-15T16:00:00-07:00",
  );
});

test("parseSpeakerEventsScript reads JS object literals without eval", () => {
  const talks = parseSpeakerEventsScript(SAMPLE_SCRIPT);
  assert.equal(talks.length, 4);
  assert.equal(talks[0].id, 3);
  assert.equal(talks[0].eventDate, "2025-10-7");
  assert.equal(talks[0].talkAbstract, "Line one\nLine two");
  assert.equal(
    talks[2].talkTitle,
    '"If anyone builds it, everyone dies": Sociotechnical Imaginaries',
  );
});

test("parseSpeakerEventsScript rejects function calls in the data array", () => {
  assert.throws(
    () =>
      parseSpeakerEventsScript(
        `const speakerEvents = [{ id: 1, talkTitle: evil() }];`,
      ),
    /unexpected token/,
  );
});

test("TBA talks use the speaker name as the published title", () => {
  assert.equal(
    talkTitleFor({
      id: 16,
      speakerName: "John Sherman",
      speakerAffiliation: "",
      speakerWebsite: "",
      talkTitle: "TBA",
      talkAbstract: "",
      eventDate: "2026-09-22",
      eventTime: "16:00",
      eventLocation: "621 Sutardja Dai Hall",
      eventLink: "",
      videoUrl: "",
      slidesUrl: "",
    }),
    "John Sherman — Berkeley AI Risk Speaker Series",
  );
});

test("mapTalkToCanonical pads dates, sets modality, and keeps a stable id", () => {
  const talks = parseSpeakerEventsScript(SAMPLE_SCRIPT);
  const chandar = mapTalkToCanonical(talks[0], "2026-09-02T00:00:00Z");
  assert.ok(chandar);
  assert.equal(chandar.source_name, "ai_risk");
  assert.equal(chandar.source_id, "3::2025-10-07");
  assert.equal(chandar.title, "Canaries in the Coal Mine");
  assert.equal(isoDateInPT(chandar.start_at), "2025-10-07");
  assert.equal(chandar.start_at, "2025-10-07T16:30:00-07:00");
  assert.equal(chandar.end_at, "2025-10-07T18:00:00-07:00");
  assert.equal(chandar.modality, "in_person");
  assert.match(chandar.description, /Stanford University/);
  assert.match(chandar.description, /slides\/chandar-slides\.pdf/);
  assert.equal(
    chandar.canonical_url,
    "https://ai-risk.berkeley.edu/speaker-series.html",
  );

  const newman = mapTalkToCanonical(talks[1], "2026-09-02T00:00:00Z");
  assert.ok(newman);
  assert.equal(newman.modality, "virtual");
  assert.equal(newman.registration_url, "https://berkeley.zoom.us/j/123");

  const sherman = mapTalkToCanonical(talks[3], "2026-09-02T00:00:00Z");
  assert.ok(sherman);
  assert.equal(sherman.title, "John Sherman — Berkeley AI Risk Speaker Series");
});
