import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveFrontendTags,
  inferCategory,
} from "../../scripts/lib/normalize.ts";

// deriveFrontendTags scores an event across the six frontend categories using
// (1) a high-confidence organizer→category map, (2) the source's own tags, and
// (3) keyword hits in title/organizer/description. These tests pin the tricky
// cases where generic words ("center", "program") would otherwise mislabel a
// community event as Academic.

test("student-services orgs route community events to Student Life, not Academic", () => {
  // Real example: a furniture-reuse / recycling drive run by SERC. The word
  // "center" in the organizer is an Academic keyword, so without the organizer
  // map this lands on Academic.
  const event = {
    title: "Cooperative Reuse 2026",
    organizer: "Student Environmental Resource Center",
    description:
      "A furniture exchange and recycling program. Donate or pick up free furniture, electronics, and other materials at the end of the semester.",
    categories: [],
  };

  assert.equal(inferCategory(event), "Student Life");
});

test("ASUC Student Union events are Student Life", () => {
  const event = {
    title: "Register for Art Studio Classes",
    organizer: "Campus Dept | ASUC Student Union",
    description: "Sign up for student art studio classes this semester.",
    categories: [],
  };

  assert.equal(inferCategory(event), "Student Life");
});

test("an academic lecture about sustainability stays Academic", () => {
  // Guardrail: topic words like "sustainable" must not pull a clearly academic
  // event into Student Life. This is why "sustainability"/"sustainable" are not
  // Student Life keywords.
  const event = {
    title: "Nordic Capitalism: Lessons for Realizing Sustainable Capitalism",
    organizer: "Institute of European Studies",
    description:
      "A research lecture on sustainable capitalism and Nordic economic policy.",
    categories: [],
  };

  assert.equal(inferCategory(event), "Academic");
});

test("a research center seminar is still Academic", () => {
  // Guardrail: genuine research centers keep the weak "center" Academic signal;
  // the Student Life organizer map is narrow and does not capture them.
  const event = {
    title: "Digital Warfare: From the Ground Up",
    organizer: "Human Rights Center",
    description: "A research seminar and lecture on digital conflict.",
    categories: [],
  };

  assert.equal(inferCategory(event), "Academic");
});

test("organizer identity map still wins for science and engineering orgs", () => {
  const event = {
    title: "Distinguished Lecture",
    organizer: "Department of Electrical Engineering and Computer Sciences",
    description: "A talk in the EECS distinguished lecture series.",
    categories: [],
  };

  assert.equal(inferCategory(event), "Science & Tech");
});

test("source-provided category tags still contribute", () => {
  const event = {
    title: "Spring Concert",
    organizer: "Some Organizer",
    description: "An evening of music.",
    categories: ["Arts"],
  };

  assert.ok(deriveFrontendTags(event).includes("Arts"));
});
