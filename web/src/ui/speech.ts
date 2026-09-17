/**
 * Reads a clearance aloud through the browser's own speech synthesiser.
 *
 * The clearance is already written the way it is spoken — "United three twenty, cleared to Seattle
 * airport, Trukn Two departure" — so it is handed to the synthesiser as it stands, with no new
 * dependency and nothing to pronounce differently. The voice is chosen rather than left to the
 * browser, because Firefox on Windows offers silent ones and flags no default. Only one clearance
 * is ever read at a time: a second request cancels the first, the cancelled one reports its end
 * (Chrome through its error handler, Firefox through its end handler), and the second reading
 * starts from there.
 */

/** The voice the clearance is read in, ATC being read in American English. */
const SPEECH_LANG = 'en-US';

/** The pace the clearance is read at, which is the synthesiser's own normal speed. */
const SPEECH_RATE = 1;

/** The error codes a cancelled utterance ends with, which is an ordinary end rather than a fault. */
const CANCEL_ERRORS: ReadonlySet<string> = new Set(['interrupted', 'canceled']);

/**
 * How long a waiting reading gives the cancelled one to report its end before it starts anyway.
 *
 * A cancelled utterance normally reports within a few milliseconds; the wait only covers a browser
 * that drops the event altogether, and is short enough to pass for an immediate start.
 */
const CANCEL_GRACE_MS = 300;

/** The Windows OneCore voices, which are the ones that speak on every browser on that platform. */
const ONECORE_VOICE = /^Microsoft (David|Zira|Mark)\b/;

/** What choosing a voice needs of one; a `SpeechSynthesisVoice` carries both fields. */
export type VoiceLike = { name: string; lang: string };

/** A reading that is waiting for the cancelled one to report before it starts. */
type QueuedReading = { start: () => void; onDone: () => void };

/** The utterance being read, so that a second reading knows to cancel it rather than race it. */
let current: SpeechSynthesisUtterance | undefined;

/** The reading waiting on the cancelled one, started by whichever of the two triggers comes first. */
let queued: QueuedReading | undefined;

/**
 * Whether this browser can read a clearance aloud.
 *
 * @returns True where the Web Speech API's synthesiser and its utterance type are both present.
 */
export function speechAvailable(): boolean {
  return 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis;
}

/**
 * The voice to read the clearance in, chosen among the American English ones the browser offers.
 *
 * Firefox on Windows lists the "Online (Natural)" and "(Natural)" voices as local ones and flags no
 * voice as the default, so an utterance with no voice set lands on one of them and is silent. The
 * Windows OneCore voices — David, Zira and Mark, the ones without "Desktop" in their name — speak
 * there as they do everywhere else, so they are taken first, then any other voice whose name says
 * it is neither online nor natural. Where nothing is left, the browser's own default is kept.
 *
 * @param voices The voices the synthesiser offers.
 * @returns The voice to read in, or undefined to leave the choice to the browser.
 */
export function pickVoice<VoiceT extends VoiceLike>(voices: readonly VoiceT[]): VoiceT | undefined {
  const american = voices.filter((voice) => voice.lang.toLowerCase() === SPEECH_LANG.toLowerCase());
  const oneCore = american.find(
    (voice) => ONECORE_VOICE.test(voice.name) && !voice.name.includes('Desktop'),
  );
  if (oneCore !== undefined) return oneCore;
  return american.find(
    (voice) => !voice.name.includes('Online') && !voice.name.includes('Natural'),
  );
}

/**
 * Reads one clearance aloud, cancelling whatever was being read before it.
 *
 * Where nothing is being read, the utterance is spoken at once. Where something is, Firefox cuts an
 * utterance spoken straight after `speechSynthesis.cancel()` off after a fraction of a second, so
 * the new reading waits for the cancelled one to report its end — or for the grace period to pass,
 * where it never reports — and starts from there.
 *
 * @param text The clearance, written the way it is spoken.
 * @param onDone Called once the reading has ended, however it ended: spoken to the last word,
 *   cancelled by another reading, or failed.
 */
export function readAloud(text: string, onDone: () => void): void {
  const utterance = newUtterance(text, onDone);
  const reading: QueuedReading = {
    start: () => {
      current = utterance;
      speechSynthesis.speak(utterance);
    },
    onDone,
  };
  if (current === undefined && !speechSynthesis.speaking && !speechSynthesis.pending) {
    reading.start();
    return;
  }
  queued?.onDone();
  queued = reading;
  speechSynthesis.cancel();
  setTimeout(() => {
    if (queued === reading) startQueued();
  }, CANCEL_GRACE_MS);
}

/** Stops the clearance being read, which ends it through the handlers `readAloud` wired. */
export function stopReading(): void {
  speechSynthesis.cancel();
}

/**
 * One utterance of a clearance, in the voice and at the pace a clearance is read.
 *
 * The voice list is empty until the browser has loaded it, which it announces with `voiceschanged`;
 * a reading that falls in that window is read in the browser's default voice rather than waiting.
 *
 * @param text The clearance, written the way it is spoken.
 * @param onDone Called once the reading has ended, however it ended.
 * @returns The utterance, with its end and error handlers wired.
 */
function newUtterance(text: string, onDone: () => void): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG;
  utterance.rate = SPEECH_RATE;
  const voice = pickVoice(speechSynthesis.getVoices());
  if (voice !== undefined) utterance.voice = voice;
  utterance.addEventListener('end', () => {
    finish(utterance, onDone);
  });
  utterance.addEventListener('error', (event) => {
    if (!CANCEL_ERRORS.has(event.error)) {
      console.warn(`reading the clearance aloud failed: ${event.error}`);
    }
    finish(utterance, onDone);
  });
  return utterance;
}

/**
 * Ends one reading: releases it, tells its caller, and starts whatever was waiting on it.
 *
 * @param utterance The utterance that has ended.
 * @param onDone The caller's callback for that reading.
 */
function finish(utterance: SpeechSynthesisUtterance, onDone: () => void): void {
  if (current === utterance) current = undefined;
  onDone();
  startQueued();
}

/** Starts the reading that was waiting on the cancelled one, where one is still waiting. */
function startQueued(): void {
  const reading = queued;
  queued = undefined;
  reading?.start();
}
