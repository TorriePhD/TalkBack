export function normalizeGuess(value: string) {
  return value
    .trim()
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function wassersteinEditDistance(a: string, b: string) {
  const source = normalizeGuess(a);
  const target = normalizeGuess(b);

  if (!source.length) {
    return target.length;
  }

  if (!target.length) {
    return source.length;
  }

  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    matrix[rowIndex][0] = rowIndex;
  }

  for (let colIndex = 0; colIndex < cols; colIndex += 1) {
    matrix[0][colIndex] = colIndex;
  }

  for (let rowIndex = 1; rowIndex < rows; rowIndex += 1) {
    for (let colIndex = 1; colIndex < cols; colIndex += 1) {
      const substitutionCost = source[rowIndex - 1] === target[colIndex - 1] ? 0 : 1;
      matrix[rowIndex][colIndex] = Math.min(
        matrix[rowIndex - 1][colIndex] + 1,
        matrix[rowIndex][colIndex - 1] + 1,
        matrix[rowIndex - 1][colIndex - 1] + substitutionCost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

export function scoreGuess(guess: string, correctPhrase: string) {
  const normalizedGuess = normalizeGuess(guess);
  const normalizedCorrectPhrase = normalizeGuess(correctPhrase);
  const maxLength = Math.max(normalizedGuess.length, normalizedCorrectPhrase.length);

  if (maxLength === 0) {
    return 10;
  }

  const distance = wassersteinEditDistance(normalizedGuess, normalizedCorrectPhrase);
  const normalizedSimilarity = 1 - distance / maxLength;

  return Math.max(0, Math.round(normalizedSimilarity * 10));
}
