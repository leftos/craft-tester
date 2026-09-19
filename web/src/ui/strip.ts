import type { AirportData, Scenario } from '@/data/schema.ts';
import { el } from '@/ui/dom.ts';

/** The printed width of the paper strip, without its border. */
const STRIP_WIDTH = 535;

/** The printed height of the paper strip, without its border. */
const STRIP_HEIGHT = 74;

/** The border the paper strip is printed inside, on every edge. */
const STRIP_BORDER = 1;

/** The width of the route column, which is what is left of the strip after the fixed columns. */
const ROUTE_CELL_WIDTH = STRIP_WIDTH - (118 + 46 + 90 + 32 + 32 + 33);

/** The horizontal padding of the route cell, on each side. */
const ROUTE_CELL_PADDING = 6;

/** The font the route is printed in, which is what its wrapping is measured against. */
const ROUTE_FONT = "bold 12px ui-monospace, 'Cascadia Mono', Consolas, monospace";

/** The width of one route character where no canvas can measure it, as under a test runner. */
const FALLBACK_CHAR_WIDTH = 7.2;

/** The width the barcode is printed across, beside the CID. */
const BARCODE_WIDTH = 70;

/** The height of every bar of the barcode. */
const BARCODE_HEIGHT = 14;

/** The most bars one barcode is printed with. */
const MAX_BARS = 64;

/** The namespace inline SVG is created in. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** One bar of the printed barcode: where it starts, and how wide it is. */
export type BarcodeBar = { x: number; width: number };

/**
 * What the controller's pen adds to a strip: the amendment number printed under the callsign, and
 * whether the strip carries the FRC remark of a full route clearance.
 */
export type StripMarks = { revision: number | undefined; frc: boolean };

/** Every field the paper strip prints, written the way the strip writes it. */
export type StripFields = {
  callsign: string;
  /** The amendment number printed under the callsign, absent on a strip as filed. */
  revision: number | undefined;
  /** The equipment cell, `F/B738/L`: the FAA wake category, the type, and the suffix as filed. */
  equipment: string;
  cid: string;
  barcodeBars: readonly BarcodeBar[];
  beacon: string;
  /** The proposed departure time, with the `P` the strip prints before it, e.g. `P1246`. */
  proposed: string;
  /** The requested altitude in hundreds of feet, three digits, e.g. `090`. */
  altitude: string;
  /** The departure and the destination, e.g. `KOAK KLAS`. */
  depDest: string;
  routeLines: readonly string[];
  remarks: string | undefined;
};

/** The measured width of one route character, which is the same for every strip on the page. */
let charWidthCache: number | undefined;

/** Measures one character of the route font, falling back where no canvas can be had. */
function measureCharWidth(): number {
  if (typeof document === 'undefined') return FALLBACK_CHAR_WIDTH;
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) return FALLBACK_CHAR_WIDTH;
  context.font = ROUTE_FONT;
  const width = context.measureText('0').width;
  return width > 0 ? width : FALLBACK_CHAR_WIDTH;
}

/** The width of one route character, measured once for the page. */
function charWidth(): number {
  charWidthCache ??= measureCharWidth();
  return charWidthCache;
}

/** How many characters of the route font fit across the route cell. */
function charsPerLine(): number {
  return Math.floor((ROUTE_CELL_WIDTH - 2 * ROUTE_CELL_PADDING) / charWidth());
}

/** Lays tokens out greedily, breaking to a new line at the last token that still fits. */
function wrapTokens(tokens: readonly string[], perLine: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line.length === 0) line = token;
    else if (line.length + 1 + token.length <= perLine) line = `${line} ${token}`;
    else {
      lines.push(line);
      line = token;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * Lays the route out as the strip prints it: the departure, the route, and the destination.
 *
 * A route too long for the cell is trimmed from the middle rather than the end, so the destination
 * stays on the paper: tokens are dropped from the tail of the route body, closest to the
 * destination first, and a `***` stands in their place. The last resort, where not even one body
 * token fits, is the departure and the destination with nothing but `***` between them.
 *
 * @param dep The departure airport identifier.
 * @param tokens The filed route, token by token.
 * @param dest The destination airport identifier.
 * @param perLine How many characters fit on one line of the route cell.
 * @param maxLines How many lines the route cell has, which is one fewer when remarks are filed.
 * @returns The lines of the route cell, at most `maxLines` of them once anything was dropped.
 */
export function routeLines(
  dep: string,
  tokens: readonly string[],
  dest: string,
  perLine: number,
  maxLines: number,
): string[] {
  const full = wrapTokens([dep, ...tokens, dest], perLine);
  if (tokens.length === 0 || full.length <= maxLines) return full;
  for (let keep = tokens.length - 1; keep > 0; keep -= 1) {
    const trimmed = wrapTokens([dep, ...tokens.slice(0, keep), '***', dest], perLine);
    if (trimmed.length <= maxLines) return trimmed;
  }
  return wrapTokens([dep, '***', dest], perLine);
}

/** The FNV-1a hash of a string, which is what the barcode pattern is drawn from. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The bars of the barcode one callsign prints.
 *
 * The pattern is dense and meaningless, as on a printed strip: bar widths alternate thin and thick
 * and the gaps tight and normal, both read off the bits of the callsign's hash, so the same flight
 * always carries the same barcode.
 *
 * @param callsign The callsign the pattern is drawn from.
 * @returns Every bar, in print order, ending where the barcode runs out of room.
 */
export function barcodeBars(callsign: string): BarcodeBar[] {
  const hash = hashOf(callsign);
  const bars: BarcodeBar[] = [];
  let x = 0;
  while (x < BARCODE_WIDTH - 1 && bars.length < MAX_BARS) {
    const index = bars.length;
    const width = ((hash >>> (index % 32)) & 1) === 1 ? 2 : 1;
    if (x + width > BARCODE_WIDTH) break;
    bars.push({ x, width });
    x += width + (((hash >>> ((index + 3) % 32)) & 1) === 1 ? 1.2 : 0.8);
  }
  return bars;
}

/** The equipment field: the FAA wake category the type carries, the type, and the suffix. */
function equipmentOf(scenario: Scenario, airport: AirportData): string {
  const cwt = airport.routeLibrary.fleet.find((entry) => entry.type === scenario.aircraftType)?.cwt;
  const prefix = cwt === undefined ? '' : `${cwt}/`;
  return `${prefix}${scenario.aircraftType}${scenario.equipmentSuffix ?? ''}`;
}

/**
 * The remarks cell: `FRC` first on a full route clearance, then whatever the flight filed, and
 * nothing at all where an ordinary clearance was filed without remarks.
 */
function remarksOf(scenario: Scenario, frc: boolean): string | undefined {
  const remarks = scenario.remarks;
  const filed = remarks === undefined || remarks.length === 0 ? undefined : remarks;
  if (!frc) return filed;
  return filed === undefined ? 'FRC' : `FRC ${filed}`;
}

/**
 * Every field of the paper strip, filled from the plan as filed.
 *
 * @param scenario The drawn flight plan.
 * @param airport The airport data, which names the departure and the fleet's FAA wake categories.
 * @param seed The scenario seed, which the computer identification is derived from.
 * @param marks The amendment number the strip was amended under, and whether it carries FRC.
 * @returns The fields, written the way the strip prints them.
 */
export function stripFields(
  scenario: Scenario,
  airport: AirportData,
  seed: number,
  marks: StripMarks,
): StripFields {
  const { revision } = marks;
  const remarks = remarksOf(scenario, marks.frc);
  const tokens = scenario.filedRoute.split(/\s+/).filter((token) => token.length > 0);
  return {
    callsign: scenario.callsign,
    revision,
    equipment: equipmentOf(scenario, airport),
    cid: String(100 + (seed % 900)),
    barcodeBars: barcodeBars(scenario.callsign),
    beacon: scenario.squawk,
    proposed: `P${scenario.localTime}`,
    altitude: String(Math.round(scenario.filedAltitude / 100)).padStart(3, '0'),
    depDest: `${airport.airport.icao} ${scenario.destination}`,
    routeLines: routeLines(
      airport.airport.icao,
      tokens,
      scenario.destination,
      charsPerLine(),
      remarks === undefined ? 3 : 2,
    ),
    remarks,
  };
}

/** One printed cell of the strip, placed by the grid and bordered by its class. */
function cell(className: string, text = ''): HTMLDivElement {
  return el('div', `strip-cell ${className}`, text);
}

/** The callsign cell, with the amendment number tucked under it once the plan was amended. */
function callsignCell(fields: StripFields): HTMLDivElement {
  const node = cell('c1 r1 strip-callsign');
  node.append(el('span', 'strip-id', fields.callsign));
  if (fields.revision !== undefined) {
    node.append(el('span', 'strip-revision', String(fields.revision)));
  }
  return node;
}

/** The barcode as inline SVG, one rectangle per bar. */
function barcodeSvg(bars: readonly BarcodeBar[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'strip-barcode');
  svg.setAttribute('width', String(BARCODE_WIDTH));
  svg.setAttribute('height', String(BARCODE_HEIGHT));
  svg.setAttribute('viewBox', `0 0 ${BARCODE_WIDTH} ${BARCODE_HEIGHT}`);
  for (const bar of bars) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(bar.x));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(bar.width));
    rect.setAttribute('height', String(BARCODE_HEIGHT));
    rect.setAttribute('fill', '#000000');
    svg.append(rect);
  }
  return svg;
}

/** The CID cell, which prints the three digits and the barcode side by side. */
function cidCell(fields: StripFields): HTMLDivElement {
  const node = cell('c1 r3 strip-cid');
  node.append(el('span', '', fields.cid), barcodeSvg(fields.barcodeBars));
  return node;
}

/** The route cell, which spans the three rows, with the remarks anchored to the last of them. */
function routeCell(fields: StripFields): HTMLDivElement {
  const node = cell('strip-route');
  for (const line of fields.routeLines) node.append(el('div', 'strip-route-line', line));
  if (fields.remarks !== undefined) {
    node.append(el('div', 'strip-remarks', fields.remarks));
  }
  return node;
}

/** The nine blank annotation boxes of columns 5 to 7, in the order the strip lays them out. */
function annotationCells(): HTMLDivElement[] {
  const cells: HTMLDivElement[] = [];
  for (const row of [1, 2, 3]) {
    for (const column of [5, 6, 7]) {
      const ruled = row < 3 ? ' strip-ruled' : '';
      const last = column === 7 ? ' strip-last' : '';
      cells.push(cell(`c${column} r${row}${ruled}${last}`));
    }
  }
  return cells;
}

/** The paper itself: the seven columns of printed and blank cells. */
function stripGrid(fields: StripFields): HTMLDivElement {
  const grid = el('div', 'strip-grid');
  grid.append(
    callsignCell(fields),
    cell('c1 r2', fields.equipment),
    cidCell(fields),
    cell('c2 r1', fields.beacon),
    cell('c2 r2', fields.proposed),
    cell('c2 r3', fields.altitude),
    cell('c3 r1', fields.depDest),
    cell('c3 r2'),
    cell('c3 r3'),
    routeCell(fields),
    ...annotationCells(),
  );
  return grid;
}

/**
 * Scales the paper to the panel it is printed in, so a phone never scrolls sideways.
 *
 * The strip is a fixed 537 px of paper; the wrapper shrinks it to whatever width the panel has and
 * takes the shrunken height, since a CSS transform leaves the space the element laid out in alone.
 *
 * @param wrapper The element the paper is printed on, whose width the scale is read from.
 * @param grid The paper, which the scale is applied to.
 */
function scaleToFit(wrapper: HTMLElement, grid: HTMLElement): void {
  const outerWidth = STRIP_WIDTH + 2 * STRIP_BORDER;
  const outerHeight = STRIP_HEIGHT + 2 * STRIP_BORDER;
  const apply = (width: number): void => {
    if (width <= 0) return;
    const scale = Math.min(1, width / outerWidth);
    grid.style.transform = `scale(${scale})`;
    wrapper.style.height = `${outerHeight * scale}px`;
  };
  if (typeof ResizeObserver === 'undefined') {
    apply(outerWidth);
    return;
  }
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) apply(entry.contentRect.width);
  });
  observer.observe(wrapper);
}

/**
 * Renders the flight plan as a paper flight progress strip.
 *
 * Amendment mode shows two strips at once, the plan as filed and the plan as amended, so the panel
 * is headed by the caller rather than by the strip itself.
 *
 * @param scenario The drawn flight plan.
 * @param airport The airport data.
 * @param seed The scenario seed.
 * @param heading The heading over the strip, e.g. `Flight plan`.
 * @param marks The amendment number the strip was amended under, and whether it carries FRC.
 * @returns The strip panel.
 */
export function renderStrip(
  scenario: Scenario,
  airport: AirportData,
  seed: number,
  heading: string,
  marks: StripMarks,
): HTMLElement {
  const panel = el('section', 'panel strip');
  const paper = el('div', 'strip-paper');
  const grid = stripGrid(stripFields(scenario, airport, seed, marks));
  paper.append(grid);
  panel.append(el('h2', '', heading), paper);
  scaleToFit(paper, grid);
  return panel;
}
