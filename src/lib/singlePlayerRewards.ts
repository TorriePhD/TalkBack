import { supabase, supabaseConfigError } from './supabase';
import type { WordDifficulty } from '../utils/difficulty';

interface AwardCoinsInput {
  userId: string;
  rewardKey: string;
  stars: number;
  difficulty: WordDifficulty;
  phrase: string;
  transcript: string;
  score: number;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

export async function awardCoins(input: AwardCoinsInput) {
  if (!input.userId.trim()) {
    throw new Error('A signed-in user is required to award BB Coins.');
  }

  const startedAt = performance.now();
  console.debug('[SinglePlayer][Reward] Awarding BB Coins.', {
    difficulty: input.difficulty,
    phrase: input.phrase,
    rewardKey: input.rewardKey,
    score: input.score,
    stars: input.stars,
    transcript: input.transcript,
  });

  const client = requireSupabase();
  const { data, error } = await client.rpc('award_single_player_reward', {
    reward_key: input.rewardKey,
    stars_input: input.stars,
    difficulty_input: input.difficulty,
    phrase_input: input.phrase,
    transcript_input: input.transcript,
    similarity_input: input.score,
  });

  if (error) {
    console.error('[SinglePlayer][Reward] BB Coin award failed.', error);
    throw new Error(`Unable to award BB Coins: ${error.message}`);
  }

  const rewardAmount = typeof data === 'number' ? Math.max(0, data) : 0;
  console.debug(
    `[SinglePlayer][Reward] BB Coin award completed in ${Math.round(performance.now() - startedAt)}ms.`,
    { rewardAmount },
  );

  return rewardAmount;
}
