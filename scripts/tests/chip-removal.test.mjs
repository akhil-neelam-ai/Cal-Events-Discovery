import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchPlan,
  removeChipWords,
  withDismissedInterpretations,
} from "../../utils/searchIntent.ts";

// The page's × on an "Interpreted as" chip takes the words that set the chip
// out of the query. These cases pin exactly which words go.

function chipWords(query) {
  const plan = buildSearchPlan(query);
  return Object.fromEntries(
    plan.interpretations.map((chip) => [
      chip.key,
      (chip.spans ?? []).map(({ start, end }) => plan.raw.slice(start, end)),
    ]),
  );
}

test("removes a single word", () => {
  assert.equal(removeChipWords("bampfa film", "topic:film"), "bampfa");
  assert.equal(removeChipWords("bampfa film", "source:bampfa"), "film");
  assert.equal(removeChipWords("bampfa", "source:bampfa"), "");
});

test("removes a multiword match as one", () => {
  assert.equal(
    removeChipWords("berkeley art museum film", "source:bampfa"),
    "film",
  );
  assert.equal(
    removeChipWords("Science and Technology talks", "category:Science & Tech"),
    "talks",
  );
  assert.equal(removeChipWords("next 7 days jazz", "dateRange:week"), "jazz");
  assert.equal(
    removeChipWords(
      "machine learning reading group",
      "topic:ai-machine-learning",
    ),
    "reading group",
  );
});

test("removes the synonym that set the chip", () => {
  assert.equal(removeChipWords("cinema at haas", "topic:film"), "at haas");
  assert.equal(removeChipWords("movie night", "topic:film"), "night");
  // Topic synonyms match whole words, so "movies" sets no Film chip and
  // there is nothing to remove.
  assert.deepEqual(Object.keys(chipWords("movies")), []);
  assert.equal(removeChipWords("movies", "topic:film"), "movies");
});

test("removes only the occurrence that set the chip", () => {
  // The topic detector takes the first "film"; the second stays as search
  // text, so the chip can come back from it.
  assert.equal(
    removeChipWords("film film festival", "topic:film"),
    "film festival",
  );
  assert.deepEqual(chipWords("film film")["topic:film"], ["film"]);
  assert.equal(removeChipWords("film film", "topic:film"), "film");
});

test("matches in any case and keeps the rest as typed", () => {
  assert.equal(removeChipWords("  BAMPFA  Film ", "topic:film"), "BAMPFA");
  assert.equal(removeChipWords("Jazz TONIGHT", "dateRange:today"), "Jazz");
});

test("whole words only, and lone punctuation goes with them", () => {
  // "filmmaker" is not "film".
  assert.deepEqual(Object.keys(chipWords("filmmaker talk")), []);
  assert.equal(removeChipWords("film, bampfa?", "source:bampfa"), "film");
  assert.equal(removeChipWords("film, bampfa?", "topic:film"), "bampfa?");
  assert.equal(removeChipWords("jazz tomorrow!", "dateRange:tomorrow"), "jazz");
  assert.equal(removeChipWords("tonight, jazz", "dateRange:today"), "jazz");
  // Punctuation that is part of a word stays.
  assert.equal(
    removeChipWords("online .net meetup", "modality:online"),
    ".net meetup",
  );
});

test("chips that share words both go when either is removed", () => {
  for (const key of ["dateRange:week", "weekend:true"]) {
    assert.equal(removeChipWords("jazz this weekend", key), "jazz");
  }
  for (const key of ["dateRange:today", "timeOfDay:evening"]) {
    assert.equal(removeChipWords("tonight", key), "");
  }
  // "this afternoon" sets Today and Afternoon from the same words.
  const words = chipWords("this afternoon yoga");
  assert.deepEqual(words["dateRange:today"], ["this afternoon"]);
  assert.deepEqual(words["timeOfDay:afternoon"], ["this afternoon"]);
  // Evening also owns the "after work" it stripped, Today does not.
  assert.equal(
    removeChipWords("tonight after work jazz", "dateRange:today"),
    "after work jazz",
  );
  assert.equal(
    removeChipWords("tonight after work jazz", "timeOfDay:evening"),
    "jazz",
  );
});

test("every chip kind records its words and can be removed", () => {
  const cases = [
    ["dateRange:today", "jazz today", "today", "jazz"],
    ["dateRange:tomorrow", "tmrw jazz", "tmrw", "jazz"],
    ["dateRange:week", "this week jazz", "this week", "jazz"],
    ["dateRange:upcoming", "upcoming jazz", "upcoming", "jazz"],
    ["weekend:true", "weekend jazz", "weekend", "jazz"],
    ["timeOfDay:morning", "morning yoga", "morning", "yoga"],
    ["timeOfDay:afternoon", "afternoon yoga", "afternoon", "yoga"],
    ["timeOfDay:evening", "evening yoga", "evening", "yoga"],
    ["source:haas", "haas talks", "haas", "talks"],
    ["topic:film", "film talk", "film", "talk"],
    ["category:Sports", "sports talk", "sports", "talk"],
    ["modality:online", "online talk", "online", "talk"],
    ["modality:in-person", "in person talk", "in person", "talk"],
    ["free:true", "free food talk", "free", "food talk"],
    ["free:true", "complimentary lunch", "complimentary", "lunch"],
    ["campusArea:northside", "north side talk", "north side", "talk"],
    ["campusArea:southside", "telegraph talk", "telegraph", "talk"],
    ["campusArea:downtown", "shattuck talk", "shattuck", "talk"],
  ];
  for (const [key, query, words, rest] of cases) {
    assert.deepEqual(chipWords(query)[key], [words], `${key} in "${query}"`);
    assert.equal(removeChipWords(query, key), rest, `${key} in "${query}"`);
    const after = buildSearchPlan(removeChipWords(query, key));
    assert.ok(
      !after.interpretations.some((chip) => chip.key === key),
      `${key} is gone after removal from "${query}"`,
    );
  }
});

test("a chip the query does not set leaves the query as it is", () => {
  assert.equal(removeChipWords("jazz", "topic:film"), "jazz");
  assert.equal(removeChipWords("", "topic:film"), "");
});

test("a free chip keeps the thing that is free", () => {
  assert.deepEqual(chipWords("music free")["free:true"], ["free"]);
  assert.equal(removeChipWords("music free", "free:true"), "music");
});

test("the agent dismiss path still searches the words of a dismissed chip", () => {
  const plan = buildSearchPlan("athletics");
  const dismissed = withDismissedInterpretations(
    plan,
    new Set(["category:Sports"]),
  );
  assert.equal(dismissed.filters.category, undefined);
  assert.equal(dismissed.cleaned, "athletics");
  assert.deepEqual(
    dismissed.interpretations.map((chip) => chip.key),
    [],
  );
});

test("every span points at real words in the raw query", () => {
  const queries = [
    "bampfa film tonight",
    "free pizza on campus this weekend",
    "AI talks at haas tomorrow morning",
    "  zoom   webinar  on   machine learning ",
    "art history lecture northgate after lunch",
    "this morning yoga morning",
    "complimentary coffee chat in person downtown berkeley",
  ];
  for (const query of queries) {
    const plan = buildSearchPlan(query);
    for (const chip of plan.interpretations) {
      assert.ok(
        chip.spans && chip.spans.length > 0,
        `${chip.key} in "${query}"`,
      );
      for (const { start, end } of chip.spans) {
        const words = plan.raw.slice(start, end);
        assert.match(words, /^\S(.*\S)?$/, `${chip.key} "${words}"`);
        assert.ok(
          start === 0 || /\W/.test(plan.raw[start - 1]),
          `${chip.key} starts on a word edge in "${query}"`,
        );
        assert.ok(
          end === plan.raw.length || /\W/.test(plan.raw[end]),
          `${chip.key} ends on a word edge in "${query}"`,
        );
      }
      if (chip.text) {
        assert.equal(
          plan.raw.slice(chip.spans[0].start, chip.spans[0].end),
          chip.text,
        );
      }
    }
  }
});
