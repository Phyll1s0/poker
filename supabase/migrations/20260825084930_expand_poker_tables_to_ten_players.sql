begin;

alter table public.poker_rooms
  drop constraint poker_rooms_max_players_check,
  add constraint poker_rooms_max_players_check
    check (max_players between 2 and 10);

alter table public.poker_room_members
  drop constraint poker_room_members_seat_check,
  add constraint poker_room_members_seat_check
    check (seat between 0 and 9);

alter table public.poker_room_messages
  drop constraint poker_room_messages_seat_check,
  add constraint poker_room_messages_seat_check
    check (author_seat between 0 and 9);

create or replace function public.poker_join_room(
  p_room_id uuid,
  p_guest_id uuid,
  p_expected_revision bigint,
  p_next_state jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seat smallint;
  v_updated integer;
begin
  if p_next_state->>'roomId' is distinct from p_room_id::text
    or (p_next_state->>'revision')::bigint <> p_expected_revision + 1
  then
    raise exception 'invalid joined room state';
  end if;

  select (seat_entry->>'seat')::smallint
  into v_seat
  from jsonb_array_elements(p_next_state->'seats') as seat_entry
  where seat_entry->>'accountId' = p_guest_id::text
  limit 1;

  if v_seat is null or v_seat < 0 or v_seat > 9 then
    raise exception 'joining guest is absent from room state';
  end if;

  update public.poker_rooms
  set
    revision = p_expected_revision + 1,
    state = p_next_state,
    updated_at = clock_timestamp()
  where id = p_room_id
    and revision = p_expected_revision
    and status = 'lobby'
    and expires_at > clock_timestamp()
    and v_seat < max_players
    and (p_next_state->>'maxPlayers')::smallint = max_players;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return false;
  end if;

  insert into public.poker_room_members (room_id, guest_id, seat)
  values (p_room_id, p_guest_id, v_seat);

  return true;
end;
$$;

revoke execute on function public.poker_join_room(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.poker_join_room(uuid, uuid, bigint, jsonb)
  to service_role;

commit;
