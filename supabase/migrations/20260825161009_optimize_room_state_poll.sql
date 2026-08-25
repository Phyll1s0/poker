begin;

create or replace function public.poker_poll_member_room(
  p_room_id uuid,
  p_guest_id uuid,
  p_rate_key text,
  p_rate_limit integer,
  p_rate_window_seconds integer,
  p_after_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room jsonb;
  v_revision bigint;
begin
  if not public.poker_consume_rate_limit(
    p_rate_key,
    p_rate_limit,
    p_rate_window_seconds
  ) then
    return jsonb_build_object(
      'rateLimited', true,
      'unchanged', false,
      'room', null
    );
  end if;

  select
    rooms.revision,
    case
      when p_after_revision is not null and rooms.revision = p_after_revision then null
      else to_jsonb(rooms)
    end
  into v_revision, v_room
  from public.poker_rooms as rooms
  join public.poker_room_members as members
    on members.room_id = rooms.id
    and members.guest_id = p_guest_id
  where rooms.id = p_room_id
    and rooms.status <> 'closed'
    and rooms.expires_at > clock_timestamp();

  if not found then
    return jsonb_build_object(
      'rateLimited', false,
      'unchanged', false,
      'room', null
    );
  end if;

  return jsonb_build_object(
    'rateLimited', false,
    'unchanged', p_after_revision is not null and v_revision = p_after_revision,
    'room', v_room
  );
end;
$$;

revoke execute on function public.poker_poll_member_room(uuid, uuid, text, integer, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.poker_poll_member_room(uuid, uuid, text, integer, integer, bigint)
  to service_role;

commit;
