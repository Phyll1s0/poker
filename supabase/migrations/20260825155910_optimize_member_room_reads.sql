begin;

create or replace function public.poker_read_member_room(
  p_room_id uuid,
  p_guest_id uuid,
  p_rate_key text,
  p_rate_limit integer,
  p_rate_window_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room jsonb;
begin
  if not public.poker_consume_rate_limit(
    p_rate_key,
    p_rate_limit,
    p_rate_window_seconds
  ) then
    return jsonb_build_object('rateLimited', true, 'room', null);
  end if;

  select to_jsonb(rooms)
  into v_room
  from public.poker_rooms as rooms
  join public.poker_room_members as members
    on members.room_id = rooms.id
    and members.guest_id = p_guest_id
  where rooms.id = p_room_id
    and rooms.status <> 'closed'
    and rooms.expires_at > clock_timestamp();

  return jsonb_build_object(
    'rateLimited', false,
    'room', v_room
  );
end;
$$;

revoke execute on function public.poker_read_member_room(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.poker_read_member_room(uuid, uuid, text, integer, integer)
  to service_role;

commit;
