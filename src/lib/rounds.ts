import type { Round } from '../features/rounds/types';
import { scoreGuess } from '../features/rounds/utils';
import { supabase, supabaseConfigError } from './supabase';
import { resolveAudioUrl, uploadAudio } from './storage/uploadAudio';

const ROUND_COLUMNS = [
  'id',
  'created_at',
  'player1_name',
  'player2_name',
  'correct_phrase',
  'original_audio_path',
  'reversed_audio_path',
  'guess',
  'attempt_audio_path',
  'attempt_reversed_path',
  'score',
  'status',
].join(', ');

interface RoundRow {
  id: string;
  created_at: string;
  player1_name: string;
  player2_name: string;
  correct_phrase: string;
  original_audio_path: string;
  reversed_audio_path: string;
  guess: string | null;
  attempt_audio_path: string | null;
  attempt_reversed_path: string | null;
  score: number | null;
  status: Round['status'];
}

interface CreateRoundRecordInput {
  player1Name: string;
  player2Name: string;
  correctPhrase: string;
  originalAudioBlob: Blob;
  reversedAudioBlob: Blob;
}

interface SaveRoundAttemptInput {
  roundId: string;
  attemptAudioBlob: Blob;
  attemptReversedBlob: Blob;
}

interface SubmitRoundGuessInput {
  roundId: string;
  guess: string;
  correctPhrase: string;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function makeRoundId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `round-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mapRoundRow(row: RoundRow): Round {
  return {
    id: row.id,
    createdAt: row.created_at,
    player1Name: row.player1_name,
    player2Name: row.player2_name,
    correctPhrase: row.correct_phrase,
    originalAudioBlob: null,
    reversedAudioBlob: null,
    originalAudioUrl: resolveAudioUrl(row.original_audio_path),
    reversedAudioUrl: resolveAudioUrl(row.reversed_audio_path),
    guess: row.guess ?? '',
    attemptAudioBlob: null,
    attemptReversedBlob: null,
    attemptAudioUrl: resolveAudioUrl(row.attempt_audio_path),
    attemptReversedUrl: resolveAudioUrl(row.attempt_reversed_path),
    score: row.score,
    status: row.status,
  };
}

export async function listRounds(): Promise<Round[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Unable to load rounds: ${error.message}`);
  }

  return ((data as unknown as RoundRow[] | null) ?? []).map(mapRoundRow);
}

export async function createRoundRecord(
  input: CreateRoundRecordInput,
): Promise<Round> {
  const client = requireSupabase();
  const roundId = makeRoundId();
  const [originalAudio, reversedAudio] = await Promise.all([
    uploadAudio(input.originalAudioBlob, { roundId, label: 'original' }),
    uploadAudio(input.reversedAudioBlob, { roundId, label: 'reversed' }),
  ]);

  const { data, error } = await client
    .from('rounds')
    .insert({
      id: roundId,
      player1_name: input.player1Name.trim(),
      player2_name: input.player2Name.trim(),
      correct_phrase: input.correctPhrase.trim(),
      original_audio_path: originalAudio.path,
      reversed_audio_path: reversedAudio.path,
      status: 'waiting_for_attempt',
    })
    .select(ROUND_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Unable to create round: ${error?.message || 'Unknown error.'}`);
  }

  return {
    ...mapRoundRow(data as unknown as RoundRow),
    originalAudioBlob: input.originalAudioBlob,
    reversedAudioBlob: input.reversedAudioBlob,
  };
}

export async function saveRoundAttempt(
  input: SaveRoundAttemptInput,
): Promise<Round> {
  const client = requireSupabase();
  const [attemptAudio, attemptReversedAudio] = await Promise.all([
    uploadAudio(input.attemptAudioBlob, {
      roundId: input.roundId,
      label: 'attempt',
    }),
    uploadAudio(input.attemptReversedBlob, {
      roundId: input.roundId,
      label: 'attempt-reversed',
    }),
  ]);

  const { data, error } = await client
    .from('rounds')
    .update({
      attempt_audio_path: attemptAudio.path,
      attempt_reversed_path: attemptReversedAudio.path,
      status: 'attempted',
    })
    .eq('id', input.roundId)
    .select(ROUND_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Unable to save the attempt: ${error?.message || 'Unknown error.'}`);
  }

  return {
    ...mapRoundRow(data as unknown as RoundRow),
    attemptAudioBlob: input.attemptAudioBlob,
    attemptReversedBlob: input.attemptReversedBlob,
  };
}

export async function submitRoundGuess(
  input: SubmitRoundGuessInput,
): Promise<Round> {
  const client = requireSupabase();
  const guess = input.guess.trim();
  const score = scoreGuess(guess, input.correctPhrase);
  const { data, error } = await client
    .from('rounds')
    .update({
      guess,
      score,
      status: 'complete',
    })
    .eq('id', input.roundId)
    .select(ROUND_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Unable to submit the guess: ${error?.message || 'Unknown error.'}`);
  }

  return mapRoundRow(data as unknown as RoundRow);
}
