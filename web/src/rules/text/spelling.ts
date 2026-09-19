/** The longest word that must be typed exactly: a letter away from a short word is another word. */
const EXACT_LENGTH = 4;

/** The longest word one edit stands in for; a longer word allows two. */
const ONE_EDIT_LENGTH = 8;

/** How many edits a word of `length` letters may be typed away from. */
function allowedEdits(length: number): number {
  if (length <= EXACT_LENGTH) return 0;
  return length <= ONE_EDIT_LENGTH ? 1 : 2;
}

/** Whether the characters either side of the cell are the adjacent pair of a transposition. */
function isTransposition(a: string, b: string, i: number, j: number): boolean {
  return i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
}

/** The distance table, flat, with the row and the column for the empty prefixes filled in. */
function initialTable(rows: number, columns: number): number[] {
  const table = Array.from({ length: rows * columns }, () => 0);
  for (let i = 0; i < rows; i += 1) table[i * columns] = i;
  for (let j = 0; j < columns; j += 1) table[j] = j;
  return table;
}

/**
 * The optimal string alignment distance: insertions, deletions, substitutions and the swap of two
 * adjacent characters, each one edit.
 *
 * @param a One word.
 * @param b The other word.
 * @returns How many edits turn one into the other.
 */
export function editDistance(a: string, b: string): number {
  const columns = b.length + 1;
  const table = initialTable(a.length + 1, columns);
  const at = (i: number, j: number): number => table[i * columns + j] ?? 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const swapped = isTransposition(a, b, i, j) ? at(i - 2, j - 2) + 1 : Infinity;
      table[i * columns + j] = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, substitution, swapped);
    }
  }
  return at(a.length, b.length);
}

/**
 * Whether a typed word says the word the reading has, spelt exactly or a letter or two away.
 *
 * A word of five to eight letters takes one edit, a longer one two, a shorter one none. A typed word
 * the vocabulary holds is read as typed, because it is a word of its own.
 *
 * @param typed The word as typed, lower-case.
 * @param expected The word the reading has, lower-case.
 * @param vocabulary Every word of the reading, of the airport's names and of its phraseology rows.
 * @returns Whether the typed word stands for the expected one.
 */
export function isNearMiss(
  typed: string,
  expected: string,
  vocabulary: ReadonlySet<string>,
): boolean {
  if (typed === expected) return true;
  if (vocabulary.has(typed)) return false;
  const allowed = allowedEdits(expected.length);
  return allowed > 0 && editDistance(typed, expected) <= allowed;
}
