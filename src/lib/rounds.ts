import type { Round } from '../features/rounds/types';
import type { ArchiveCompletedRoundSummary } from '../features/rounds/types';
import type { RoundStarCount } from '../features/rounds/types';
import { scoreGuess } from '../features/rounds/utils';
import { supabase, supabaseConfigError } from './supabase';
import { createSignedAudioUrl, uploadAudio } from './storage/uploadAudio';

const ROUND_COLUMNS = [
  'id',
  'created_at',
  'sender_id',
  'sender_email',
  'sender_username',
  'recipient_id',
  'recipient_email',
  'recipient_username',
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
  sender_username: string;
  recipient_id: string;
  recipient_email: string;
  recipient_username: string;
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

interface ArchiveCompletedRoundInput {
  currentUserId: string;
  roundId: string;
}

interface ArchiveCompletedRoundRow {
  friendship_id: string;
  user_one_id: string;
  user_one_email: string;
  user_two_id: string;
  user_two_email: string;
  completed_round_count: number;
  total_star_score: number;
  average_star_score: number | null;
  next_sender_id: string | null;
  last_completed_at: string | null;
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

function isMissingStorageObjectError(message: string) {
  return /not found|does not exist|no such key|not exist/i.test(message);
}

export function scoreToStars(score: number | null): RoundStarCount {
  if (score === null) {
    return 0;
  }

  if (score >= 10) {
    return 3;
  }

  if (score >= 8) {
    return 2;
  }

  if (score >= 5) {
    return 1;
  }

  return 0;
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
    senderUsername: row.sender_username,
    recipientId: row.recipient_id,
    recipientEmail: row.recipient_email,
    recipientUsername: row.recipient_username,
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

export async function archiveCompletedRound(
  input: ArchiveCompletedRoundInput,
): Promise<ArchiveCompletedRoundSummary> {
  const client = requireSupabase();
  const { data: roundData, error: roundError } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .eq('id', input.roundId)
    .single();

  if (roundError || !roundData) {
    throw new Error(`Unable to load the round to archive: ${roundError?.message || 'Unknown error.'}`);
  }

  const round = roundData as unknown as RoundRow;
  if (round.sender_id !== input.currentUserId) {
    throw new Error('Only the original sender can archive this round.');
  }

  if (round.status !== 'complete') {
    throw new Error('Only completed rounds can be archived.');
  }

  const storagePaths = Array.from(
    new Set(
      [
        round.original_audio_path,
        round.reversed_audio_path,
        round.attempt_audio_path,
        round.attempt_reversed_path,
      ].filter((path): path is string => Boolean(path)),
    ),
  );

  if (storagePaths.length > 0) {
    const { error: deleteError } = await client.storage.from('audio').remove(storagePaths);

    if (deleteError && !isMissingStorageObjectError(deleteError.message)) {
      throw new Error(`Unable to remove the archived audio: ${deleteError.message}`);
    }
  }

  const { data, error } = await client.rpc('archive_completed_round', {
    round_id: input.roundId,
  });

  if (error) {
    throw new Error(`Unable to archive the completed round: ${error.message}`);
  }

  const archivedRow = ((data as ArchiveCompletedRoundRow[] | null) ?? [])[0];
  if (!archivedRow) {
    throw new Error('The completed round could not be archived.');
  }

  return {
    roundId: input.roundId,
    friendshipId: archivedRow.friendship_id,
    friendId: round.recipient_id,
    senderId: round.sender_id,
    recipientId: round.recipient_id,
    completedRoundCount: archivedRow.completed_round_count,
    averageStars: archivedRow.average_star_score,
    nextSenderId: archivedRow.next_sender_id,
    lastCompletedAt: archivedRow.last_completed_at,
  };
}
