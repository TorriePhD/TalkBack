create or replace function public.spend_resource(uid uuid, rtype text, amt integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_type text := lower(btrim(coalesce(rtype, '')));
  next_amount integer;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to spend resources.';
  end if;

  if uid is distinct from current_user_id then
    raise exception 'You can only spend your own resources.';
  end if;

  if normalized_type = '' then
    raise exception 'A resource type is required.';
  end if;

  if amt is null or amt <= 0 then
    raise exception 'Spend amount must be greater than zero.';
  end if;

  insert into public.user_resources (user_id, resource_type, amount)
  values (uid, normalized_type, 0)
  on conflict (user_id, resource_type) do nothing;

  update public.user_resources
  set amount = amount - amt,
      updated_at = timezone('utc', now())
  where user_id = uid
    and resource_type = normalized_type
    and amount >= amt
  returning amount into next_amount;

  if next_amount is null then
    raise exception 'Insufficient balance.';
  end if;

  return jsonb_build_object(
    'user_id', uid,
    'resource_type', normalized_type,
    'amount', next_amount,
    'spent', amt
  );
end;
$$;

grant execute on function public.spend_resource(uuid, text, integer) to authenticated;
