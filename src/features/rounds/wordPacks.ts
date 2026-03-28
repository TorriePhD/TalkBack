import {
  listWordPacks,
  loadWordPackById,
  resolveWordPackId,
  type WordDifficulty,
  type WordEntry,
  type WordPack,
  type WordPackWithWords,
} from '../../lib/wordPacks';
import { computeDifficulty, normalizePackText } from '../../utils/difficulty';

const LAST_PRESENTED_PHRASE_KEY = 'word_packs_last_presented_phrase';
const MIN_BUCKET_SIZE = 2;
const DIFFICULTY_ORDER: WordDifficulty[] = ['easy', 'medium', 'hard'];
const FALLBACK_CREATED_AT = '1970-01-01T00:00:00.000Z';
const FALLBACK_PACK_ID = 'fallback-pack';

export interface WordOption extends WordEntry {
  displayDifficulty: WordDifficulty;
}

export interface RoundWordPackLoadResult {
  packs: WordPack[];
  selectedPack: WordPackWithWords;
  selectedPackId: string;
  source: 'remote' | 'fallback';
  error: string | null;
}

const FALLBACK_WORD_PACK: WordPackWithWords = {
  id: FALLBACK_PACK_ID,
  name: 'Starter Pack',
  description: 'Small built-in fallback pack used when remote packs are unavailable.',
  isFree: true,
  createdAt: FALLBACK_CREATED_AT,
  words: [
    'tiny spoon',
    'quiet hallway',
    'paper airplane',
    'silver lantern',
    'window chorus',
    'midnight bicycle',
    'electric calendar',
    'whispering volcano',
    'backward meteor shower',
  ].map((text, index) => buildFallbackWord(text, index)),
};

function buildFallbackWord(text: string, index: number): WordEntry {
  const normalizedText = normalizePackText(text);
  const metrics = computeDifficulty(normalizedText);

  return {
    id: `fallback-word-${index}`,
    packId: FALLBACK_PACK_ID,
    text: normalizedText,
    syllables: metrics.syllables,
    charLength: metrics.charLength,
    difficulty: metrics.difficulty,
    createdAt: FALLBACK_CREATED_AT,
  };
}

function getFallbackPackSummary(): WordPack {
  return {
    id: FALLBACK_WORD_PACK.id,
    name: FALLBACK_WORD_PACK.name,
    description: FALLBACK_WORD_PACK.description,
    isFree: FALLBACK_WORD_PACK.isFree,
    createdAt: FALLBACK_WORD_PACK.createdAt,
  };
}

function getWordScore(word: WordEntry) {
  return word.syllables + word.charLength * 0.15;
}

function getTargetScore(difficulty: WordDifficulty) {
  if (difficulty === 'easy') {
    return 2.4;
  }

  if (difficulty === 'medium') {
    return 5.2;
  }

  return 8.2;
}

function getDifficultyDistance(word: WordEntry, targetDifficulty: WordDifficulty) {
  return Math.abs(getWordScore(word) - getTargetScore(targetDifficulty));
}

function getDifficultyBuckets(words: WordEntry[]) {
  return words.reduce<Record<WordDifficulty, WordEntry[]>>(
    (buckets, word) => {
      buckets[word.difficulty].push(word);
      return buckets;
    },
    { easy: [], medium: [], hard: [] },
  );
}

function dedupeWords(words: WordEntry[]) {
  const dedupedWords: WordEntry[] = [];
  const seenTexts = new Set<string>();

  for (const word of words) {
    const normalizedText = normalizePackText(word.text);

    if (!normalizedText || seenTexts.has(normalizedText)) {
      continue;
    }

    const metrics = computeDifficulty(normalizedText);

    seenTexts.add(normalizedText);
    dedupedWords.push({
      ...word,
      text: normalizedText,
      syllables: Number.isFinite(word.syllables) ? word.syllables : metrics.syllables,
      charLength: Number.isFinite(word.charLength) ? word.charLength : metrics.charLength,
      difficulty: word.difficulty ?? metrics.difficulty,
    });
  }

  return dedupedWords;
}

function normalizeWordPack(pack: WordPackWithWords): WordPackWithWords {
  return {
    ...pack,
    name: pack.name.trim(),
    description: pack.description?.trim() ?? null,
    words: dedupeWords(pack.words),
  };
}

function rebalanceBucket(
  targetDifficulty: WordDifficulty,
  buckets: Record<WordDifficulty, WordEntry[]>,
  allWords: WordEntry[],
) {
  const rebalancedBucket = [...buckets[targetDifficulty]].sort(
    (left, right) =>
      getDifficultyDistance(left, targetDifficulty) -
      getDifficultyDistance(right, targetDifficulty),
  );

  if (rebalancedBucket.length >= MIN_BUCKET_SIZE) {
    return rebalancedBucket;
  }

  const supplements = allWords
    .filter(
      (word) =>
        !rebalancedBucket.some((candidate) => candidate.text === word.text),
    )
    .sort(
      (left, right) =>
        getDifficultyDistance(left, targetDifficulty) -
        getDifficultyDistance(right, targetDifficulty),
    );

  for (const word of supplements) {
    if (rebalancedBucket.length >= MIN_BUCKET_SIZE) {
      break;
    }

    rebalancedBucket.push(word);
  }

  return rebalancedBucket;
}

function randomItem<T>(items: T[]) {
  if (!items.length) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function pickWordForDifficulty(
  targetDifficulty: WordDifficulty,
  buckets: Record<WordDifficulty, WordEntry[]>,
  usedTexts: Set<string>,
  blockedText: string | null,
) {
  const orderedDifficulties = [...DIFFICULTY_ORDER].sort(
    (left, right) =>
      Math.abs(getTargetScore(left) - getTargetScore(targetDifficulty)) -
      Math.abs(getTargetScore(right) - getTargetScore(targetDifficulty)),
  );

  for (const difficulty of orderedDifficulties) {
    const bucket = buckets[difficulty].filter(
      (word) => !usedTexts.has(word.text) && word.text !== blockedText,
    );
    const pick = randomItem(bucket);

    if (pick) {
      return pick;
    }
  }

  return null;
}

function getSafeCandidateWords(words: WordEntry[]) {
  const normalizedWords = dedupeWords(words);

  if (normalizedWords.length >= 3) {
    return normalizedWords;
  }

  return dedupeWords([...normalizedWords, ...FALLBACK_WORD_PACK.words]);
}

function hasLocalStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readLastPresentedPhrase() {
  if (!hasLocalStorage()) {
    return null;
  }

  const phrase = window.localStorage.getItem(LAST_PRESENTED_PHRASE_KEY);
  return phrase ? normalizePackText(phrase) : null;
}

export function rememberPresentedPhrase(phrase: string) {
  if (!hasLocalStorage()) {
    return;
  }

  window.localStorage.setItem(
    LAST_PRESENTED_PHRASE_KEY,
    normalizePackText(phrase),
  );
}

export function getDefaultPackId(packs: WordPack[]) {
  return packs[0]?.id ?? FALLBACK_WORD_PACK.id;
}

export function getWordPackOptions(packs: WordPack[]) {
  return packs.map((pack) => ({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    isFree: pack.isFree,
  }));
}

export async function loadRoundWordPacks(
  requestedPackId?: string | null,
): Promise<RoundWordPackLoadResult> {
  try {
    const packs = await listWordPacks();

    if (!packs.length) {
      throw new Error('No word packs are available yet.');
    }

    const selectedPackId = resolveWordPackId(packs, requestedPackId);

    if (!selectedPackId) {
      throw new Error('No word pack could be selected.');
    }

    const selectedPack = await loadWordPackById(selectedPackId);

    if (!selectedPack) {
      throw new Error('The selected pack could not be loaded.');
    }

    const normalizedPack = normalizeWordPack(selectedPack);

    if (!normalizedPack.words.length) {
      throw new Error('The selected pack has no usable words.');
    }

    return {
      packs,
      selectedPack: normalizedPack,
      selectedPackId,
      source: 'remote',
      error: null,
    };
  } catch (error) {
    return {
      packs: [getFallbackPackSummary()],
      selectedPack: FALLBACK_WORD_PACK,
      selectedPackId: FALLBACK_WORD_PACK.id,
      source: 'fallback',
      error:
        error instanceof Error
          ? error.message
          : 'Unable to load word packs. Using the starter pack instead.',
    };
  }
}

export function getThreeOptions(
  words: WordEntry[],
  previousPhrase?: string | null,
) {
  const blockedText =
    previousPhrase === undefined
      ? readLastPresentedPhrase()
      : previousPhrase
        ? normalizePackText(previousPhrase)
        : null;
  const candidateWords = getSafeCandidateWords(words);
  const baseBuckets = getDifficultyBuckets(candidateWords);
  const rebalancedBuckets: Record<WordDifficulty, WordEntry[]> = {
    easy: rebalanceBucket('easy', baseBuckets, candidateWords),
    medium: rebalanceBucket('medium', baseBuckets, candidateWords),
    hard: rebalanceBucket('hard', baseBuckets, candidateWords),
  };
  const usedTexts = new Set<string>();

  return DIFFICULTY_ORDER.map((difficulty) => {
    const pickedWord =
      pickWordForDifficulty(difficulty, rebalancedBuckets, usedTexts, blockedText) ??
      candidateWords.find(
        (word) => !usedTexts.has(word.text) && word.text !== blockedText,
      ) ??
      FALLBACK_WORD_PACK.words.find(
        (word) => !usedTexts.has(word.text) && word.text !== blockedText,
      ) ??
      FALLBACK_WORD_PACK.words[0];

    usedTexts.add(pickedWord.text);

    return {
      ...pickedWord,
      displayDifficulty: difficulty,
    } satisfies WordOption;
  });
}
