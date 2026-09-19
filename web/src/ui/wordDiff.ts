/** A stretch of a label, and whether the other label lacks it. */
export type DiffRun = { text: string; differs: boolean };

/** A label split into its words and the whitespace between them, in order. */
type Piece = { text: string; word: boolean };

/** The whitespace a label is split at, kept so the runs join back to the label. */
const WHITESPACE = /(\s+)/u;

/** The punctuation at either end of a word, which two labels are compared without. */
const WORD_EDGES = /^\p{P}+|\p{P}+$/gu;

function piecesOf(label: string): Piece[] {
  return label
    .split(WHITESPACE)
    .filter((text) => text.length > 0)
    .map((text) => ({ text, word: text.trim().length > 0 }));
}

/** A word as the two labels are compared by it: lower-cased, its punctuation trimmed off. */
function keyOf(piece: Piece): string {
  return piece.text.toLowerCase().replace(WORD_EDGES, '');
}

/** The words of a label, in order, each as the key it is compared by. */
function keysOf(pieces: readonly Piece[]): string[] {
  return pieces.filter((piece) => piece.word).map(keyOf);
}

/** How long a common subsequence every pair of suffixes of two word lists has, as a lookup. */
type SuffixLengths = (i: number, j: number) => number;

function lcsLengths(said: readonly string[], expected: readonly string[]): SuffixLengths {
  const width = expected.length + 1;
  const table = Array.from({ length: (said.length + 1) * width }, () => 0);
  const at: SuffixLengths = (i, j) => table[i * width + j] ?? 0;
  for (let i = said.length - 1; i >= 0; i -= 1) {
    for (let j = expected.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        said[i] === expected[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
}

/** Which words of each label lie in their longest common subsequence, the earliest match winning. */
function commonWords(
  said: readonly string[],
  expected: readonly string[],
): { said: boolean[]; expected: boolean[] } {
  const at = lcsLengths(said, expected);
  const common = { said: said.map(() => false), expected: expected.map(() => false) };
  let i = 0;
  let j = 0;
  while (i < said.length && j < expected.length) {
    if (said[i] === expected[j]) {
      common.said[i] = true;
      common.expected[j] = true;
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return common;
}

/** Which pieces are marked: a word outside the common subsequence, and whitespace between two. */
function markedPieces(pieces: readonly Piece[], common: readonly boolean[]): boolean[] {
  let seen = 0;
  const words = pieces.map((piece) => {
    if (!piece.word) return false;
    const marked = common[seen] !== true;
    seen += 1;
    return marked;
  });
  return pieces.map((piece, index) =>
    piece.word ? words[index] === true : words[index - 1] === true && words[index + 1] === true,
  );
}

/** The pieces as runs, neighbours marked alike joined into one with the whitespace between them. */
function runsOf(pieces: readonly Piece[], marked: readonly boolean[]): DiffRun[] {
  const runs: DiffRun[] = [];
  pieces.forEach((piece, index) => {
    const differs = marked[index] === true;
    const last = runs.at(-1);
    if (last !== undefined && last.differs === differs) last.text += piece.text;
    else runs.push({ text: piece.text, differs });
  });
  return runs;
}

/** The label as the one run nothing is marked on, and no run at all where it has no text. */
function plainRuns(label: string): DiffRun[] {
  return label.length === 0 ? [] : [{ text: label, differs: false }];
}

/**
 * The two labels as runs, the words one of them has and the other lacks marked in each.
 *
 * Words are compared lower-cased and without the punctuation at their ends, and aligned by longest
 * common subsequence. Whitespace is marked only between two marked words, so a mark covers the
 * words that differ and nothing around them. Two labels with no word in common mark nothing:
 * marking every word of both says no more than the two lines already do.
 *
 * @param said The label the student answered with.
 * @param expected The label the answer is held against.
 * @returns The runs of each label, which join back to it exactly.
 */
export function diffWords(
  said: string,
  expected: string,
): { said: DiffRun[]; expected: DiffRun[] } {
  const saidPieces = piecesOf(said);
  const expectedPieces = piecesOf(expected);
  const common = commonWords(keysOf(saidPieces), keysOf(expectedPieces));
  if (!common.said.includes(true)) return { said: plainRuns(said), expected: plainRuns(expected) };
  return {
    said: runsOf(saidPieces, markedPieces(saidPieces, common.said)),
    expected: runsOf(expectedPieces, markedPieces(expectedPieces, common.expected)),
  };
}
