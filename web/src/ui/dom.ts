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
