import type { Round } from '../features/rounds/types';
import { scoreGuess } from '../features/rounds/utils';
import { supabase, supabaseConfigError } from './supabase';
import { createSignedAudioUrl, uploadAudio } from './storage/uploadAudio';

const ROUND_COLUMNS = [
  'id',
  'created_at',
  'sender_id',
  'sender_email',
  'recipient_id',
  'recipient_email',
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
  sender_id: string;
  sender_email: string;
  recipient_id: string;
  recipient_email: string;
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
  currentUserId: string;
  recipientId: string;
  correctPhrase: string;
  originalAudioBlob: Blob;
  reversedAudioBlob: Blob;
}

interface SaveRoundAttemptInput {
  currentUserId: string;
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

async function mapRoundRow(row: RoundRow): Promise<Round> {
  const [originalAudioUrl, reversedAudioUrl, attemptAudioUrl, attemptReversedUrl] =
    await Promise.all([
      createSignedAudioUrl(row.original_audio_path),
      createSignedAudioUrl(row.reversed_audio_path),
      createSignedAudioUrl(row.attempt_audio_path),
      createSignedAudioUrl(row.attempt_reversed_path),
    ]);

  return {
    id: row.id,
    createdAt: row.created_at,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    recipientId: row.recipient_id,
    recipientEmail: row.recipient_email,
    correctPhrase: row.correct_phrase,
    originalAudioBlob: null,
    reversedAudioBlob: null,
    originalAudioUrl,
    reversedAudioUrl,
    guess: row.guess ?? '',
    attemptAudioBlob: null,
    attemptReversedBlob: null,
    attemptAudioUrl,
    attemptReversedUrl,
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

  return Promise.all(((data as unknown as RoundRow[] | null) ?? []).map(mapRoundRow));
}

export async function createRoundRecord(
  input: CreateRoundRecordInput,
): Promise<Round> {
  const client = requireSupabase();
  const roundId = makeRoundId();
  const [originalAudio, reversedAudio] = await Promise.all([
    uploadAudio(input.originalAudioBlob, {
      ownerId: input.currentUserId,
      roundId,
      label: 'original',
    }),
    uploadAudio(input.reversedAudioBlob, {
      ownerId: input.currentUserId,
      roundId,
      label: 'reversed',
    }),
  ]);

  const { data, error } = await client
    .from('rounds')
    .insert({
      id: roundId,
      recipient_id: input.recipientId,
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
    ...(await mapRoundRow(data as unknown as RoundRow)),
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
      ownerId: input.currentUserId,
      roundId: input.roundId,
      label: 'attempt',
    }),
    uploadAudio(input.attemptReversedBlob, {
      ownerId: input.currentUserId,
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
    ...(await mapRoundRow(data as unknown as RoundRow)),
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
