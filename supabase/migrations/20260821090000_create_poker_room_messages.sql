create table public.poker_room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.poker_rooms(id) on delete cascade,
  guest_id uuid not null references public.poker_guests(id) on delete cascade,
  request_id text not null,
  author_seat smallint not null,
  author_handle text not null,
  kind text not null,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint poker_room_messages_request_id_check
    check (request_id ~ '^[a-zA-Z0-9._:-]{8,128}$'),
  constraint poker_room_messages_seat_check check (author_seat between 0 and 5),
  constraint poker_room_messages_handle_check
    check (char_length(author_handle) between 2 and 16),
  constraint poker_room_messages_kind_check check (kind in ('text', 'reaction')),
  constraint poker_room_messages_body_check
    check (char_length(body) between 1 and 120 and octet_length(body) <= 512),
  constraint poker_room_messages_reaction_check
    check (kind <> 'reaction' or body in ('👍', '😂', '😮', '😅', '🔥', '🤔')),
  constraint poker_room_messages_request_unique unique (room_id, guest_id, request_id)
);

create index poker_room_messages_room_cursor_idx
  on public.poker_room_messages (room_id, id desc);

alter table public.poker_room_messages enable row level security;

revoke all on table public.poker_room_messages from anon, authenticated;
revoke all on sequence public.poker_room_messages_id_seq from public, anon, authenticated;
grant all on table public.poker_room_messages to service_role;
grant usage, select on sequence public.poker_room_messages_id_seq to service_role;

create policy poker_room_messages_deny_client_access
on public.poker_room_messages
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.poker_append_room_message(
  p_room_id uuid,
  p_guest_id uuid,
  p_request_id text,
  p_kind text,
  p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message public.poker_room_messages%rowtype;
  v_author_seat smallint;
  v_author_handle text;
begin
  if p_request_id !~ '^[a-zA-Z0-9._:-]{8,128}$'
    or p_kind not in ('text', 'reaction')
    or char_length(p_body) < 1
    or char_length(p_body) > 120
    or octet_length(p_body) > 512
    or (p_kind = 'reaction' and p_body not in ('👍', '😂', '😮', '😅', '🔥', '🤔'))
  then
    raise exception 'invalid room message';
  end if;

  select * into v_message
  from public.poker_room_messages as existing
  where existing.room_id = p_room_id
    and existing.guest_id = p_guest_id
    and existing.request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'message', jsonb_build_object(
        'id', v_message.id::text,
        'seat', v_message.author_seat,
        'handle', v_message.author_handle,
        'kind', v_message.kind,
        'content', v_message.body,
        'createdAt', v_message.created_at
      ),
      'duplicate', true,
      'conflict', v_message.kind is distinct from p_kind or v_message.body is distinct from p_body
    );
  end if;

  select members.seat, guests.handle
  into v_author_seat, v_author_handle
  from public.poker_room_members as members
  join public.poker_guests as guests
    on guests.id = members.guest_id
    and guests.expires_at > clock_timestamp()
  join public.poker_rooms as rooms
    on rooms.id = members.room_id
    and rooms.status <> 'closed'
    and rooms.expires_at > clock_timestamp()
  where members.room_id = p_room_id
    and members.guest_id = p_guest_id
  for key share of members;

  if not found then
    raise exception 'room membership unavailable';
  end if;

  insert into public.poker_room_messages (
    room_id, guest_id, request_id, author_seat, author_handle, kind, body
  )
  values (
    p_room_id, p_guest_id, p_request_id, v_author_seat, v_author_handle, p_kind, p_body
  )
  on conflict (room_id, guest_id, request_id)
  do nothing
  returning * into v_message;

  if not found then
    select * into v_message
    from public.poker_room_messages as raced
    where raced.room_id = p_room_id
      and raced.guest_id = p_guest_id
      and raced.request_id = p_request_id;

    return jsonb_build_object(
      'message', jsonb_build_object(
        'id', v_message.id::text,
        'seat', v_message.author_seat,
        'handle', v_message.author_handle,
        'kind', v_message.kind,
        'content', v_message.body,
        'createdAt', v_message.created_at
      ),
      'duplicate', true,
      'conflict', v_message.kind is distinct from p_kind or v_message.body is distinct from p_body
    );
  end if;

  delete from public.poker_room_messages as messages
  where messages.room_id = p_room_id
    and messages.id in (
      select stale.id
      from public.poker_room_messages as stale
      where stale.room_id = p_room_id
      order by stale.id desc
      offset 200
    );

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message.id::text,
      'seat', v_message.author_seat,
      'handle', v_message.author_handle,
      'kind', v_message.kind,
      'content', v_message.body,
      'createdAt', v_message.created_at
    ),
    'duplicate', false,
    'conflict', false
  );
end;
$$;

revoke execute on function public.poker_append_room_message(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.poker_append_room_message(uuid, uuid, text, text, text)
  to service_role;
