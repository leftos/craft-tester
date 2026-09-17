/** One choice of a dropdown: the value the form reads back, and the text the player sees. */
export type SelectOption = { value: string; label: string };

/** Everything one labelled dropdown needs to render. */
export type SelectSpec = {
  label: string;
  options: readonly SelectOption[];
  value: string | undefined;
  disabled: boolean;
  placeholder: string;
};

/**
 * Creates an element, with the class and the text most of this app's nodes carry.
 *
 * @param tag The tag name.
 * @param className The class attribute, omitted when empty.
 * @param text The text content, omitted when empty.
 * @returns The new element.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className.length > 0) node.className = className;
  if (text.length > 0) node.textContent = text;
  return node;
}

/**
 * Builds a two-column table of label and value rows, which is how the strip and the ATIS read.
 *
 * @param className The class of the list element.
 * @param rows The label and value of each row.
 * @returns The definition list.
 */
export function rowList(
  className: string,
  rows: readonly (readonly [string, string])[],
): HTMLDListElement {
  const list = el('dl', className);
  for (const [label, value] of rows) {
    list.append(el('dt', '', label), el('dd', '', value));
  }
  return list;
}

/** The blank first option, which reads back as no pick at all. */
function placeholderOption(spec: SelectSpec): HTMLOptionElement {
  const option = el('option', '', spec.placeholder);
  option.value = '';
  option.selected = spec.value === undefined;
  return option;
}

/**
 * Builds one labelled dropdown.
 *
 * @param spec The label, the choices, the current value, and whether the dropdown is enabled.
 * @param onChange Called with the value the dropdown reads back after every change.
 * @returns The label element, with the dropdown inside it.
 */
export function selectControl(
  spec: SelectSpec,
  onChange: (value: string) => void,
): HTMLLabelElement {
  const field = el('label', 'field');
  const select = el('select');
  select.disabled = spec.disabled;
  select.append(placeholderOption(spec));
  for (const option of spec.options) {
    const node = el('option', '', option.label);
    node.value = option.value;
    node.selected = option.value === spec.value;
    select.append(node);
  }
  select.addEventListener('change', () => {
    onChange(select.value);
  });
  field.append(el('span', 'field-label', spec.label), select);
  return field;
}

/**
 * The dropdown inside a control `selectControl` built.
 *
 * @param field The label element the builder returned.
 * @returns The dropdown it wraps.
 * @throws Error When the element is not one `selectControl` built.
 */
export function selectOf(field: HTMLElement): HTMLSelectElement {
  const select = field.querySelector('select');
  if (select === null) throw new Error('the control holds no dropdown');
  return select;
}

/**
 * Writes a value and an enabled state into a dropdown already on screen.
 *
 * The value is written only when it differs from what the dropdown already reads, so a control the
 * student is working in is left alone. The choices are not rewritten: every list this form offers
 * is a function of the scenario, which does not change while the dropdown is on screen.
 *
 * @param node The dropdown to update.
 * @param value The value it should read, or `undefined` for its blank choice.
 * @param disabled Whether it should be enabled.
 * @returns Nothing; the dropdown is updated in place.
 */
export function syncSelect(
  node: HTMLSelectElement,
  value: string | undefined,
  disabled: boolean,
): void {
  const next = value ?? '';
  if (node.value !== next) node.value = next;
  node.disabled = disabled;
}

/** Everything one labelled text box needs to render. */
export type TextSpec = {
  label: string;
  name: string;
  value: string;
  disabled: boolean;
  placeholder: string;
};

/**
 * Builds one labelled text box, for a value the student writes rather than picks.
 *
 * Autocomplete and spellcheck are off: the values are callsigns, type designators and route strings,
 * which a browser's suggestions and red underlines only get in the way of. The name is what a box
 * is found by after the page is rendered again, which is how a box the student is typing in keeps
 * its focus.
 *
 * @param spec The label, the name, the current value, whether the box is enabled, and the placeholder.
 * @param onInput Called with the text the box reads back after every keystroke.
 * @returns The label element, with the text box inside it.
 */
export function textControl(spec: TextSpec, onInput: (value: string) => void): HTMLLabelElement {
  const field = el('label', 'field');
  const input = el('input');
  input.type = 'text';
  input.name = spec.name;
  input.value = spec.value;
  input.disabled = spec.disabled;
  input.placeholder = spec.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    onInput(input.value);
  });
  field.append(el('span', 'field-label', spec.label), input);
  return field;
}

/**
 * The text box inside a control `textControl` built.
 *
 * @param field The label element the builder returned.
 * @returns The text box it wraps.
 * @throws Error When the element is not one `textControl` built.
 */
export function textOf(field: HTMLElement): HTMLInputElement {
  const input = field.querySelector('input');
  if (input === null) throw new Error('the control holds no text box');
  return input;
}

/**
 * Writes a value and an enabled state into a text box already on screen.
 *
 * The value is written only when it differs from what the box already holds, so the word the
 * student is halfway through typing is never taken from under the caret.
 *
 * @param node The text box to update.
 * @param value The text it should hold.
 * @param disabled Whether it should be enabled.
 * @returns Nothing; the text box is updated in place.
 */
export function syncText(node: HTMLInputElement, value: string, disabled: boolean): void {
  if (node.value !== value) node.value = value;
  node.disabled = disabled;
}

/**
 * Builds a button.
 *
 * @param label The text on the button.
 * @param className The class attribute.
 * @param onClick Called when the button is pressed.
 * @returns The button.
 */
export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/**
 * Writes an enabled state into a button already on screen.
 *
 * @param node The button to update.
 * @param disabled Whether it should be enabled.
 * @returns Nothing; the button is updated in place.
 */
export function syncButton(node: HTMLButtonElement, disabled: boolean): void {
  node.disabled = disabled;
}

/** The namespace inline SVG is created in. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The drawn size of an icon, in pixels, which is what the icon's box is sized against. */
const ICON_SIZE = 18;

/**
 * Builds a button that carries an icon instead of a word, its label being what it reads as.
 *
 * The icon is drawn inline rather than loaded, so it takes the button's own colour and needs no
 * request of its own; it is hidden from a screen reader, which reads the label instead.
 *
 * @param label The accessible name of the button, shown as its tooltip.
 * @param className The class attribute, after the `icon` class every icon button carries.
 * @param iconPath The path the icon is drawn from, in a 24 by 24 box.
 * @param onClick Called when the button is pressed.
 * @returns The button, with the icon inside it.
 */
export function iconButton(
  label: string,
  className: string,
  iconPath: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = el('button', `icon ${className}`.trim());
  node.type = 'button';
  node.title = label;
  node.setAttribute('aria-label', label);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(ICON_SIZE));
  svg.setAttribute('height', String(ICON_SIZE));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', iconPath);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  node.append(svg);
  node.addEventListener('click', onClick);
  return node;
}
