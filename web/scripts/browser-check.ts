/**
 * Drives the preview build through one scenario at a forced viewport and records what it shows.
 *
 * Usage, with `pnpm -C web build && pnpm -C web preview` serving in another shell:
 *
 *   pnpm -C web check:browser <name> <hash> [phone|desktop] [action...]
 *
 * `hash` is the URL hash to open, written with commas between its parts so no shell sees an `&`:
 * `s=1,a=KSFO,d=KLVK` (the `a=` part picks the airport, the `d=` part forces the destination) or
 * `s=4,a=KOAK,d=KSMF,m=amend`. Each action runs in order before the page is recorded:
 *
 *   select:<index>=<label>   choose an option of the n-th `<select>` on the page by its label
 *   fill:<index>=<text>      type into the n-th text field (text inputs and textareas, in page order)
 *   press:<key>              press a key on whatever has focus, e.g. `press:Enter` after a `fill`
 *   click:<button text>      press the button with that text
 *
 * The page's text, its selects, inputs and buttons, every console error, and whether it scrolls
 * sideways are written to `.tmp/browser-check/<name>-<viewport>.json` next to a full-page
 * screenshot, and the essentials are printed. Playwright's Chromium must be installed once with
 * `pnpm -C web exec playwright install chromium`.
 *
 * `CRAFT_PREVIEW_URL` overrides the preview the run opens, so two previews on different ports can
 * be checked at once: `CRAFT_PREVIEW_URL=http://localhost:4174/craft-tester/`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env['CRAFT_PREVIEW_URL'] ?? 'http://localhost:4173/craft-tester/';
const OUT_DIR = '../.tmp/browser-check';

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;

/** What one run records about the page after its actions have run. */
type Report = {
  hash: string;
  overflow: boolean;
  scrollWidth: number;
  innerWidth: number;
  overflowing: string[];
  text: string;
  selects: { value: string; options: string[] }[];
  inputs: { type: string; value: string }[];
  buttons: string[];
  errors: string[];
};

function isViewportName(value: string): value is ViewportName {
  return value in VIEWPORTS;
}

function usage(): never {
  console.error('usage: pnpm -C web check:browser <name> <hash> [phone|desktop] [action...]');
  process.exit(2);
}

const [name, hashArg, viewportArg = 'desktop', ...actions] = process.argv.slice(2);
if (name === undefined || hashArg === undefined || !isViewportName(viewportArg)) usage();
const viewportName: ViewportName = viewportArg;
const hash = `#${hashArg.replace(/^#/, '').replaceAll(',', '&')}`;

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORTS[viewportName] });
const errors: string[] = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    errors.push(`${message.type()}: ${message.text()}`);
  }
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(`${BASE}${hash}`, { waitUntil: 'networkidle' });

for (const action of actions) {
  const separator = action.indexOf(':');
  const kind = action.slice(0, separator);
  const rest = action.slice(separator + 1);
  const equals = rest.indexOf('=');
  if (kind === 'select') {
    const index = Number(rest.slice(0, equals));
    await page
      .locator('select')
      .nth(index)
      .selectOption({ label: rest.slice(equals + 1) });
  } else if (kind === 'fill') {
    const index = Number(rest.slice(0, equals));
    await page
      .locator('input[type="text"], textarea')
      .nth(index)
      .fill(rest.slice(equals + 1));
  } else if (kind === 'press') {
    await page.keyboard.press(rest);
  } else if (kind === 'click') {
    await page.getByRole('button', { name: rest }).first().click();
  } else {
    console.error(`unknown action ${action}`);
    usage();
  }
  await page.waitForTimeout(100);
}

const recorded = await page.evaluate(() => {
  const past = (node: Element): boolean =>
    node.getBoundingClientRect().right > window.innerWidth + 1;
  const overflowing = [...document.querySelectorAll('body *')]
    .filter((node) => past(node) && ![...node.children].some(past))
    .slice(0, 8)
    .map((node) => {
      const classes = node.className ? `.${String(node.className).split(' ').join('.')}` : '';
      const right = Math.round(node.getBoundingClientRect().right);
      return `${node.tagName.toLowerCase()}${classes} right=${right}`;
    });
  return {
    hash: location.hash,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflowing,
    text: document.body.innerText,
    selects: [...document.querySelectorAll('select')].map((select) => ({
      value: select.value,
      options: [...select.options].map((option) => option.label),
    })),
    inputs: [
      ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
    ].map((input) => ({ type: input.type, value: input.value })),
    buttons: [...document.querySelectorAll('button')].map(
      (button) => button.textContent?.trim() || button.getAttribute('aria-label') || '',
    ),
  };
});
const report: Report = { ...recorded, errors };

await page.screenshot({ path: `${OUT_DIR}/${name}-${viewportName}.png`, fullPage: true });
await writeFile(`${OUT_DIR}/${name}-${viewportName}.json`, JSON.stringify(report, null, 2));
await browser.close();

console.log(`hash: ${report.hash}`);
console.log(
  `overflow: ${report.overflow} (scrollWidth ${report.scrollWidth}, innerWidth ${report.innerWidth})`,
);
if (report.overflowing.length > 0)
  console.log(`overflowing:\n  ${report.overflowing.join('\n  ')}`);
console.log(
  `console errors: ${errors.length}${errors.length > 0 ? `\n  ${errors.join('\n  ')}` : ''}`,
);
console.log(`selects: ${report.selects.map((select) => select.value || '—').join(' | ')}`);
console.log(`buttons: ${report.buttons.join(' | ')}`);
console.log('--- text ---');
console.log(report.text);
