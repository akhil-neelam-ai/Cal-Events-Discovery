# How the flyer-wall redesign was done

On November 19, 2026, cal-events.com went from a generic dark hero to a campus flyer wall. Seven pull requests shipped it that day, Pacific time. They covered the home page (306), two fixes found in use (308, 316), the static pages (314, 317), and both link-preview images (313, 315). This note records how it was done, the design system it produced, and what to repeat on the next site.

## Where it started

The old home page was the standard generated landing page. A review of the live page found these patterns:

- **A dark hero.** A navy gradient with blurred circles, a gold underline border, a "live" pulse badge, and a centered serif headline with one phrase in gold italics.
- **A search box in a white rounded card**, inside the hero.
- **Pills everywhere.** Suggestions, date ranges, categories, topics and the update badge all had the same rounded shape.
- **Small all-caps labels** over every group, such as "CAMPUS FEED" and "FIELDS".
- **Identical event cards** with one shadow, a gradient stripe, three small icons, a hover lift and a staggered fade-in.
- **Little on screen.** A laptop showed no complete event before scrolling. A phone showed two.

Each of these was decoration that carried no information. The goal, in the owner's words, was a page students would love that did not read as AI slop. In practice that meant four rules:

1. The page should look like it could only be an events site.
2. Every visual choice should carry information or a campus memory.
3. Mockups use the real feed, never placeholder events.
4. Phones come first. Just over half of visitors use one.

## The process

| Step | What happened | Output |
|---|---|---|
| 1. Critique | Listed what read as generated, with counts from the live page and this week's feed | A short written review |
| 2. Directions | Built three working mockups on real data | Three standalone HTML pages |
| 3. Pick | The owner reviewed them on a phone and chose one | Flyer Wall |
| 4. Build | Built it on a branch with a Vercel preview, never on main | PR 306 |
| 5. Feedback | Two rounds on the preview | Buttons and a close square |
| 6. Ship | Merged after a phone test, then reran the acceptance test on production | 55 of 55 checks |
| 7. Fix in use | The owner used the live site and reported problems | PRs 308, 316 |
| 8. Roll out | Carried the design to every other surface | PRs 313, 314, 315, 317 |
| 9. Audit | Ran a full site audit before and after | Score 85, then 84, with fixes chosen |

### Three directions, built on real data

Each direction was a standalone HTML page that loaded this week's real feed (222 events). They lived in a scratch folder and were checked in a local browser at phone and laptop widths. Each was published as a private Claude artifact for review. A "preview clock" pinned to Thursday 3:12 PM could be dragged to show morning and night.

| Direction | Idea |
|---|---|
| A. Timetable | The day as a schedule. Each start time prints once, and a gold line marks now. |
| B. Flyer Wall | A campus kiosk. Each event is a sheet of colored copy paper, and the paper color is the category. |
| C. Ask | One sentence with two blanks on Cal gold: "I'm free *tonight* and up for *anything*." |

The recommendation was C on top of A, with B called the most fun but the slowest to scan. The owner chose B. That is the point of working mockups: the owner decides on feel, which a written proposal cannot show.

### Build on a branch, review on a preview

The owner asked for a dev preview before anything reached main. PR 306 was built on `redesign/flyer-wall`, and every push gave a Vercel preview. Before asking for review:

- `npm run validate` and the Playwright suite passed.
- Screenshots were taken at 390, 768, 1024 and 1440 pixels wide.
- A 55-check filter acceptance test ran against the built branch. It covers date tabs, all six categories, topics, sources, search, shared links and the phone filters drawer. It compares what the wall shows with `events.json`.

The redesign changed no behavior. Search, filters, URL state, agent tools and the data pipeline stayed the same, which kept the review about looks alone.

### Two feedback rounds

The first preview used the metaphor too literally. An open flyer had tear-off tabs for its actions, with vertical text on paper-colored strips. The owner said people would not realize on first use that they had to tap them. The fix had three parts:

- **Actions became black horizontal buttons**, one filled and the rest outlined.
- **A 44px black close square** was pinned to the flyer's top-right corner.
- **A "Back to the wall" button** was added at the end of the flyer.

The owner approved, tested on a phone, and asked to ship. After the merge, the 55 checks ran again on production and passed.

### Fixes found in use

Real use found two things the preview review missed. Removing a search chip cleared its filter but left its words in the search box. PR 308 made the chip's × remove its words and added "Clear all". The owner then asked for the wordmark to be clickable, so PR 316 made it a home link that resets the view in place.

### Rolling the design out

The home page was only one surface. These followed:

| Surface | PR | Notes |
|---|---|---|
| Site-wide link-preview image | 313 | Redrawn from an HTML source with `npm run render-og-image`. The old PNG had a white band, text running off the edge, and the old domain. Down from 484 KB to 98 KB. |
| About, Privacy, 404 | 314 | One plain sheet on the wall. A right-hand facts column was removed after review because it repeated the text. |
| Per-event chat card | 315 | The card chat apps show for a shared event. It still had the old navy and serif look, because nobody sees it inside the app. |
| For Agents page | 317 | Shipped without a preview, at the owner's request. |

### The audit

A full squirrelscan crawl scored 85 (B) after the home page shipped and 84 (B) after the roll-out. Accessibility, images, mobile, social previews and core SEO stayed at 100. The point lost came from the For Agents page joining the others in loading the Google Fonts stylesheet. The owner chose two fixes: structured data for the For Agents page, and serving Archivo from the site itself. Both were in progress when this note was written.

## The design system

The theme lives in the `@theme` block of `index.css`. The static pages copy the values into `public/site-pages.css`. The event card copies the paper colors into `PAPER_COLORS` in `api/_lib/eventPreview.ts`, and a test keeps them equal.

| Token | Value | Use |
|---|---|---|
| Wall | `#003262` | Page background, Berkeley blue |
| Chalk | `#ffffff` | Text written on the wall |
| Toner | `#121212` | Text and buttons on paper |
| Plain paper | `#fcfcf9` | The notice, descriptions, static pages, uncategorized events |
| Gold | `#fdb515` | "Surprise me" sticker, focus rings on the wall, link underlines on chalk |
| Academic | `#ffe55e` | Paper |
| Arts | `#ff93c6` | Paper |
| Sports | `#ffa052` | Paper |
| Science & Tech | `#93d2ff` | Paper |
| Student Life | `#83e4a5` | Paper |
| Entrepreneurship | `#d0b6ff` | Paper |

The rules:

- **Paper color is the category.** It comes from `tags[0]` through `utils/flyerWall.ts`. Color carries meaning, so it is never decoration.
- **One typeface.** Archivo, a variable font with a width axis from 62 to 125 and weights from 100 to 900. Every role is a `font-stretch` and weight pair. The wordmark is wide and heavy (118%, 900). Dates are narrow and heavy (62%, 900).
- **Chalk on the wall, toner on paper.** View headings, day strips and the footer are white text on blue. Everything on a sheet is black.
- **Sheets are physical.** Each tilts between -0.8 and 0.8 degrees, fixed by a hash of its id so it never jumps. Each has a staple mark. The notice tilts -0.5 degrees.
- **Ink buttons.** Anything pressed on paper is black: one filled (`btn-toner`), the rest outlined (`btn-line`), with 44px minimum targets.
- **Masonry without reordering.** CSS grid with 4px rows, and `hooks/useMasonry.ts` sets each sheet's row span. DOM order stays the reading order. Evening events at big venues and home games get a double-width sheet.
- **Never:** gradients, shadows, rounded cards or all-caps labels.

Static pages use one sheet, `page page-text`, capped at 44rem so lines stay readable. A rotated sheet tilted every line and drifted on long pages, so only the top and bottom edges slant, through `clip-path`. Each ends with a filled "Back to the wall" button.

The two preview images follow the same system. `scripts/og-image.html` is the source of the site-wide PNG. `api/event-image.tsx` draws each event as its flyer with `@vercel/og`.

## What went wrong, and the fix

| Problem | Fix |
|---|---|
| The metaphor hid the controls. Vertical, paper-colored tear-off tabs did not read as buttons. | Black horizontal buttons and a corner close square. |
| Removing a chip left its words in the search box. | The chip's × removes its words. "Clear all" resets everything. |
| A facts column on About and Privacy repeated the text beside it. | Removed. The sheet narrowed to 44rem, and Privacy's date moved under the lead. |
| The site-wide preview image was broken, and nobody had looked. | Redrawn from a source file, then checked at 300px, the size chat apps show. |
| The per-event card kept the old design, since it never appears in the app. | Redrawn as a flyer. Fetching it with a crawler user agent shows what chat apps get. |
| The card renderer (satori) cannot read a variable font. | Five static Archivo instances in `api/_fonts`. |
| The renderer leaves a wide space after "y," or "y.". | Not fixed. It comes from how the renderer applies kerning. |
| `vercel curl` on a protected preview quietly created a Protection Bypass for Automation key. | The key was revoked. Agent briefs now say not to run it. Use a signed-in browser for previews. |
| Parallel agents risked colliding in one working tree. | Each agent ran in its own git worktree on its own branch. |

## Checklist for the next redesign

This is the order to use on akhilneelam.com or any other site.

1. **Critique the live page with numbers.** Count what shows above the fold on a phone, and name each generated pattern.
2. **List every surface before starting.** Pages, 404, link-preview images for the site and for single items, favicon, and anything a crawler sees.
3. **Build two or three directions as working pages on real content.** Review them on a phone first.
4. **Pick one metaphor, then audit every control against it.** Each control should contrast with its surface, use a horizontal verb label, and sit apart from content. Every pop-up gets a corner close button.
5. **Keep behavior fixed while the look changes.** Write an acceptance test for what must not change, and run it before and after the deploy.
6. **Build on a branch with a preview.** Take screenshots at 390, 768, 1024 and 1440, and have the owner test on a phone.
7. **Remove anything that repeats nearby text**, such as a summary column beside a short page.
8. **Fetch the preview images the way a chat app does**, then look at them full size and at 300px.
9. **Keep tokens in one place.** Where a copy is unavoidable, add a test that keeps it equal.
10. **Run an audit before and after**, and explain any point lost.

For akhilneelam.com, a push to main deploys production, so show screenshots before pushing.
