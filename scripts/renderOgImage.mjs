/**
 * Renders scripts/og-image.html to public/og-image.png, the 1200x630 link
 * preview every page names as og:image.
 *
 *   npm run render-og-image
 *   npm run render-og-image -- --out <png> --thumb <png>
 *
 * --out writes somewhere other than public/og-image.png. --thumb also writes
 * a 300px-wide copy, about the size a chat app shows. Check that one reads.
 * Needs Chromium (`npm run install:browsers`) and the network, since the
 * page loads Archivo from Google Fonts like the site does.
 */
/* global document -- page.evaluate callbacks run in the browser */
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";

const WIDTH = 1200;
const HEIGHT = 630;
const THUMB_WIDTH = 300;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "scripts", "og-image.html");
const { values } = parseArgs({
  options: { out: { type: "string" }, thumb: { type: "string" } },
});
const output = path.resolve(
  values.out ?? path.join(root, "public", "og-image.png"),
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(source).href, { waitUntil: "networkidle" });

  // Fail rather than save a picture drawn in a fallback face.
  const loaded = await page.evaluate(async () => {
    const faces = await document.fonts.load("900 100px Archivo", "CalEvents");
    await document.fonts.ready;
    return faces.filter((face) => face.status === "loaded").length;
  });
  if (loaded === 0) {
    throw new Error("Archivo did not load from Google Fonts.");
  }

  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  await writeFile(output, png);
  const { size } = await stat(output);
  console.log(`Wrote ${output} (${Math.round(size / 1024)} KB)`);

  if (values.thumb) {
    const thumbHeight = Math.round((HEIGHT * THUMB_WIDTH) / WIDTH);
    const thumbPage = await browser.newPage({
      viewport: { width: THUMB_WIDTH, height: thumbHeight },
    });
    const dataUrl = `data:image/png;base64,${(await readFile(output)).toString("base64")}`;
    await thumbPage.setContent(
      `<body style="margin:0"><img src="${dataUrl}" width="${THUMB_WIDTH}" height="${thumbHeight}" style="display:block"></body>`,
    );
    const thumb = path.resolve(values.thumb);
    await thumbPage.screenshot({ path: thumb });
    console.log(`Wrote ${thumb}`);
  }
} finally {
  await browser.close();
}
