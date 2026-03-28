create or replace function public.complete_round_and_award_resources(
  round_id uuid,
  guess_input text,
  score_input integer,
  difficulty_input text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  normalized_guess text := btrim(coalesce(guess_input, ''));
  normalized_difficulty text := lower(btrim(coalesce(difficulty_input, '')));
  stars integer;
  difficulty_multiplier integer;
  coins_awarded integer;
  inserted_transaction_id uuid;
  reward_user_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to complete a round.';
  end if;

  if round_id is null then
    raise exception 'A round id is required.';
  end if;

  if normalized_guess = '' then
    raise exception 'A guess is required.';
  end if;

  select *
  into round_row
  from public.rounds
  where id = round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if round_row.recipient_id <> current_user_id then
    raise exception 'Only the recipient can complete this round.';
  end if;

  if round_row.status = 'complete' then
    return round_row;
  end if;

  if round_row.status <> 'attempted' then
    raise exception 'Round cannot be completed before an attempt is saved.';
  end if;

  if round_row.attempt_audio_path is null or round_row.attempt_reversed_path is null then
    raise exception 'Round attempt not found.';
  end if;

  if score_input is null or score_input < 0 or score_input > 10 then
    raise exception 'Score must be between 0 and 10.';
  end if;

  if round_row.difficulty is not null and btrim(round_row.difficulty) <> '' then
    normalized_difficulty := round_row.difficulty;
  end if;

  if normalized_difficulty is null or normalized_difficulty = '' then
    raise exception 'A difficulty value is required to award coins.';
  end if;

  if normalized_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'Invalid difficulty value.';
  end if;

  stars := public.score_to_stars(score_input);

  difficulty_multiplier := case normalized_difficulty
    when 'easy' then 1
    when 'medium' then 2
    when 'hard' then 3
  end;

  coins_awarded := stars * difficulty_multiplier;

  update public.rounds
  set
    guess = normalized_guess,
    score = score_input,
    status = 'complete',
    difficulty = normalized_difficulty,
    rewarded_at = case
      when round_row.rewarded_at is null then timezone('utc'::text, now())
      else round_row.rewarded_at
    end
  where id = round_row.id
  returning * into round_row;

  if round_row.rewarded_at is not null then
    foreach reward_user_id in array array[round_row.recipient_id, round_row.sender_id] loop
      continue when reward_user_id is null;

      insert into public.transactions (
        user_id,
        resource_type,
        amount,
        reason,
        metadata
      )
      values (
        reward_user_id,
        'bb_coin',
        coins_awarded,
        'round_reward',
        jsonb_build_object(
          'round_id', round_row.id,
          'stars', stars,
          'difficulty', normalized_difficulty,
          'score', score_input
        )
      )
      on conflict do nothing
      returning id into inserted_transaction_id;

      if inserted_transaction_id is not null then
        insert into public.user_resources (user_id, resource_type, amount)
        values (reward_user_id, 'bb_coin', coins_awarded)
        on conflict (user_id, resource_type)
        do update set
          amount = public.user_resources.amount + excluded.amount,
          updated_at = now();
      end if;

      inserted_transaction_id := null;
    end loop;
  end if;

  return round_row;
end;
$$;
