import { normalizePackText, type WordDifficulty } from '../utils/difficulty';
import { supabase, supabaseConfigError } from './supabase';
export type { WordDifficulty } from '../utils/difficulty';

export interface WordPack {
  id: string;
  name: string;
  description: string | null;
  isFree: boolean;
  createdAt: string;
}

export interface WordEntry {
  id: string;
  packId: string;
  text: string;
  syllables: number;
  charLength: number;
  difficulty: WordDifficulty;
  createdAt: string;
}

export interface WordPackWithWords extends WordPack {
  words: WordEntry[];
}

interface WordPackRow {
  id: string;
  name: string;
  description: string | null;
  is_free: boolean;
  created_at: string;
}

interface WordRow {
  id: string;
  pack_id: string;
  text: string;
  syllables: number;
  char_length: number;
  difficulty: WordDifficulty;
  created_at: string;
}

interface CachedPayload<T> {
  timestamp: number;
  data: T;
}

const MAX_CACHE_AGE_MS = 1000 * 60 * 60 * 24;
const WORD_PACKS_CACHE_KEY = 'word_packs_cache';
const WORDS_CACHE_PREFIX = 'word_pack_words_cache:';

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function readCachedPayload<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CachedPayload<T>;

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.timestamp !== 'number' ||
      Date.now() - parsed.timestamp > MAX_CACHE_AGE_MS
    ) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedPayload<T>(key: string, data: T) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload: CachedPayload<T> = {
    timestamp: Date.now(),
    data,
  };

  window.localStorage.setItem(key, JSON.stringify(payload));
}

function mapWordPackRow(row: WordPackRow): WordPack {
  return {
    id: row.id,
    name: row.name.trim(),
    description: row.description?.trim() ?? null,
    isFree: row.is_free,
    createdAt: row.created_at,
  };
}

function mapWordRow(row: WordRow): WordEntry {
  return {
    id: row.id,
    packId: row.pack_id,
    text: normalizePackText(row.text),
    syllables: row.syllables,
    charLength: row.char_length,
    difficulty: row.difficulty,
    createdAt: row.created_at,
  };
}

export function resolveWordPackId(
  packs: WordPack[],
  requestedPackId?: string | null,
) {
  const normalizedRequestedPackId = requestedPackId?.trim();

  if (normalizedRequestedPackId) {
    const matchingPack = packs.find((pack) => pack.id === normalizedRequestedPackId);
    if (matchingPack) {
      return matchingPack.id;
    }
  }

  return packs[0]?.id ?? null;
}

export async function listWordPacks(options?: {
  useCache?: boolean;
}): Promise<WordPack[]> {
  const useCache = options?.useCache ?? true;

  if (useCache) {
    const cachedPacks = readCachedPayload<WordPack[]>(WORD_PACKS_CACHE_KEY);
    if (cachedPacks && cachedPacks.length > 0) {
      return cachedPacks;
    }
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('word_packs')
    .select('id, name, description, is_free, created_at')
    .order('created_at', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Unable to load word packs: ${error.message}`);
  }

  const packs = ((data as WordPackRow[] | null) ?? []).map(mapWordPackRow);

  if (useCache && packs.length > 0) {
    writeCachedPayload(WORD_PACKS_CACHE_KEY, packs);
  }

  return packs;
}

export async function listWordsByPackId(
  packId: string,
  options?: {
    useCache?: boolean;
  },
): Promise<WordEntry[]> {
  const normalizedPackId = packId.trim();
  if (!normalizedPackId) {
    return [];
  }

  const useCache = options?.useCache ?? true;
  const cacheKey = `${WORDS_CACHE_PREFIX}${normalizedPackId}`;

  if (useCache) {
    const cachedWords = readCachedPayload<WordEntry[]>(cacheKey);
    if (cachedWords && cachedWords.length > 0) {
      return cachedWords;
    }
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('words')
    .select('id, pack_id, text, syllables, char_length, difficulty, created_at')
    .eq('pack_id', normalizedPackId)
    .order('created_at', { ascending: true })
    .order('char_length', { ascending: true })
    .order('text', { ascending: true });

  if (error) {
    throw new Error(`Unable to load words for that pack: ${error.message}`);
  }

  const words = ((data as WordRow[] | null) ?? []).map(mapWordRow);

  if (useCache && words.length > 0) {
    writeCachedPayload(cacheKey, words);
  }

  return words;
}

export async function loadWordPackById(
  packId: string,
  options?: {
    useCache?: boolean;
  },
): Promise<WordPackWithWords | null> {
  const normalizedPackId = packId.trim();
  if (!normalizedPackId) {
    return null;
  }

  const packs = await listWordPacks(options);
  const pack = packs.find((entry) => entry.id === normalizedPackId);

  if (!pack) {
    return null;
  }

  const words = await listWordsByPackId(normalizedPackId, options);

  return {
    ...pack,
    words,
  };
}

export async function loadSelectedWordPack(
  requestedPackId?: string | null,
  options?: {
    useCache?: boolean;
  },
): Promise<WordPackWithWords | null> {
  const packs = await listWordPacks(options);
  const selectedPackId = resolveWordPackId(packs, requestedPackId);

  if (!selectedPackId) {
    return null;
  }

  const selectedPack = packs.find((pack) => pack.id === selectedPackId);
  const words = await listWordsByPackId(selectedPackId, options);

  if (!selectedPack) {
    return null;
  }

  return {
    ...selectedPack,
    words,
  };
}
