/**
 * Reads a clearance aloud through the browser's own speech synthesiser.
 *
 * The clearance is already written the way it is spoken — "United three twenty, cleared to Seattle
 * airport, Trukn Two departure" — so it is handed to the synthesiser as it stands, with no new
 * dependency and nothing to pronounce differently. Only one clearance is ever read at a time: a
 * second request cancels the first, and the cancelled one ends through its error handler.
 */

/** The voice the clearance is read in, ATC being read in American English. */
const SPEECH_LANG = 'en-US';

/** The pace the clearance is read at, which is the synthesiser's own normal speed. */
const SPEECH_RATE = 1;

/** The error codes a cancelled utterance ends with, which is an ordinary end rather than a fault. */
const CANCEL_ERRORS: ReadonlySet<string> = new Set(['interrupted', 'canceled']);

/**
 * Whether this browser can read a clearance aloud.
 *
 * @returns True where the Web Speech API's synthesiser and its utterance type are both present.
 */
export function speechAvailable(): boolean {
  return 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis;
}

/**
 * Reads one clearance aloud, cancelling whatever was being read before it.
 *
 * @param text The clearance, written the way it is spoken.
 * @param onDone Called once the reading has ended, however it ended: spoken to the last word,
 *   cancelled by another reading, or failed.
 */
export function readAloud(text: string, onDone: () => void): void {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG;
  utterance.rate = SPEECH_RATE;
  utterance.addEventListener('end', () => {
    onDone();
  });
  utterance.addEventListener('error', (event) => {
    if (!CANCEL_ERRORS.has(event.error)) {
      console.warn(`reading the clearance aloud failed: ${event.error}`);
    }
    onDone();
  });
  speechSynthesis.speak(utterance);
}

/** Stops the clearance being read, which ends it through the error handler `readAloud` wired. */
export function stopReading(): void {
  speechSynthesis.cancel();
}
