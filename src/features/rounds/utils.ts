export function normalizeGuess(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function scoreGuess(guess: string, correctPhrase: string) {
  return normalizeGuess(guess) === normalizeGuess(correctPhrase) ? 10 : 0;
}
