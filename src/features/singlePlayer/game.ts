import type { WordDifficulty } from '../../utils/difficulty';
import type { WordOption } from '../rounds/wordPacks';

export type SinglePlayerPhase =
  | 'selecting'
  | 'recording-original'
  | 'playing-reversed'
  | 'recording-imitation'
  | 'processing'
  | 'result';

export function getSinglePlayerStars(score: number) {
  if (score >= 0.9) {
    return 3;
  }

  if (score >= 0.75) {
    return 2;
  }

  if (score >= 0.6) {
    return 1;
  }

  return 0;
}

export function formatDifficultyLabel(difficulty: WordDifficulty) {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

export function mapOptionsByDifficulty(options: WordOption[]) {
  return options.reduce<Record<WordDifficulty, WordOption | null>>(
    (result, option) => {
      result[option.displayDifficulty] = option;
      return result;
    },
    { easy: null, medium: null, hard: null },
  );
}
