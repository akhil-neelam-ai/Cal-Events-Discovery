import { expect, test } from "@playwright/test";

function pacificDateKey(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function buildFixtureEvents() {
  const today = pacificDateKey(0);
  const tomorrow = pacificDateKey(1);

  return [
    {
      id: "evt-dreams",
      title: "Dreams Are Colder Than Death",
      organizer: "BAMPFA",
      date: today,
      time: "7:00 PM",
      location: "BAMPFA — Berkeley Art Museum & Pacific Film Archive",
      description: "A film screening at BAMPFA for Berkeley students.",
      tags: ["Arts"],
      url: "https://example.com/dreams",
      source: "bampfa",
    },
    {
      id: "evt-ai",
      title: "AI Research Forum",
      organizer: "Berkeley AI Lab",
      date: tomorrow,
      time: "5:00 PM",
      location: "Soda Hall",
      description: "A science talk about machine learning.",
      tags: ["Science & Tech"],
      url: "https://example.com/ai",
      source: "livewhale",
    },
    {
      id: "evt-free-food",
      title: "Free Pizza Mixer",
      organizer: "Student Union",
      date: today,
      time: "6:00 PM",
      location: "MLK Student Union",
      description: "Free food and student social.",
      tags: ["Student Life"],
      url: "https://example.com/pizza",
      source: "callink",
    },
  ];
}

function buildStatusReport(totalEvents: number) {
  const now = new Date().toISOString();

  return {
    generated_at: now,
    total_events: totalEvents,
    duplicates_removed: 0,
    past_events_filtered: 0,
    invalid_events_filtered: 0,
    sources: [
      {
        name: "bampfa",
        ok: true,
        count: 1,
        duration_ms: 10,
        fetched_at: now,
      },
      {
        name: "livewhale",
        ok: true,
        count: 1,
        duration_ms: 10,
        fetched_at: now,
      },
      {
        name: "callink",
        ok: true,
        count: 1,
        duration_ms: 10,
        fetched_at: now,
      },
    ],
    fallback_used: false,
    degraded: false,
    last_good_used: 0,
  };
}

test.beforeEach(async ({ page }) => {
  const events = buildFixtureEvents();
  const status = buildStatusReport(events.length);

  await page.route("**/events.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events,
        sources: [],
        lastUpdated: Date.now(),
      }),
    });
  });

  await page.route("**/status.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status),
    });
  });

  await page.route("**/search-index.json", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "search index intentionally disabled" }),
    });
  });

  await page.route("**/favicon.ico", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route("**/_vercel/**", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
});

test("preserves search and filter state across detail open and reload", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 2, name: /today/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: /all events/i }).click();
  await page.getByRole("button", { name: /^arts$/i }).click();

  const searchInput = page.getByRole("textbox", {
    name: /search campus events/i,
  });
  await searchInput.fill("dreams");

  await expect(
    page.getByRole("heading", { level: 2, name: /arts · upcoming/i }),
  ).toBeVisible();
  await expect(page.getByText("Dreams Are Colder Than Death")).toBeVisible();
  await expect(page.getByText("AI Research Forum")).toHaveCount(0);

  await page
    .getByRole("button", {
      name: /open details for dreams are colder than death/i,
    })
    .click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/q=dreams/);
  await expect(page).toHaveURL(/category=Arts/);
  await expect(page).toHaveURL(/date=upcoming/);
  await expect(page).toHaveURL(/event=evt-dreams/);

  await page.reload({ waitUntil: "networkidle" });

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /search campus events/i }),
  ).toHaveValue("dreams");
  await expect(
    page.getByRole("heading", { level: 2, name: /arts · upcoming/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /view official page/i }),
  ).toHaveAttribute("href", "https://example.com/dreams");
});
