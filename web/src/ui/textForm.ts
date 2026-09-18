import { button, el, syncButton, syncText, textAreaControl, textAreaOf } from '@/ui/dom.ts';

/** Everything the typing box needs to render: the clearance typed so far and the two handlers. */
export type TextFormProps = { text: string; onText: (text: string) => void; onSubmit: () => void };

/** The typing box: the panel on screen, and how to write a later state of it into the box it built. */
export type TextForm = { node: HTMLElement; sync: (props: TextFormProps) => void };

/** Whether the typing box holds nothing to grade, which is nothing but whitespace. */
function blank(text: string): boolean {
  return text.trim() === '';
}

/**
 * Renders the typing box the student reads the whole clearance into.
 *
 * The panel is built once and every later keystroke is written into the box it already holds, so
 * the box keeps its focus and its caret. The handlers read the props when the event arrives rather
 * than the ones the box was built with, because the box outlives them. Enter submits, as the button
 * does; a box holding nothing but whitespace is refused by the state, and the button stays disabled
 * for it.
 *
 * @param props The clearance typed so far, and the handlers for a keystroke and for submit.
 * @returns The panel, and the sync that writes a later state of the same box into it.
 */
export function renderTextForm(props: TextFormProps): TextForm {
  let current = props;
  const panel = el('section', 'panel typed');
  const field = textAreaControl(
    { label: 'clearance', name: 'clearance', value: props.text, disabled: false, placeholder: '' },
    (value) => {
      current.onText(value);
    },
    () => {
      current.onSubmit();
    },
  );
  const area = textAreaOf(field);
  const submit = button('Submit clearance', 'primary', () => {
    current.onSubmit();
  });
  submit.disabled = blank(props.text);
  panel.append(
    el('h2', '', 'Your clearance'),
    el(
      'p',
      'muted',
      'Type the clearance as you would read it on frequency. The callsign is optional.',
    ),
    field,
    submit,
  );
  return {
    node: panel,
    sync: (next) => {
      current = next;
      syncText(area, next.text, false);
      syncButton(submit, blank(next.text));
    },
  };
}
