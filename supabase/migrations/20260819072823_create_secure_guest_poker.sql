create table public.poker_guests (
  id uuid primary key,
  handle text not null,
  handle_key text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint poker_guests_handle_length_check check (char_length(handle) between 2 and 16),
  constraint poker_guests_handle_key_length_check check (char_length(handle_key) between 2 and 64),
  constraint poker_guests_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint poker_guests_expiry_check check (expires_at > created_at)
);

create unique index poker_guests_handle_key_uidx on public.poker_guests (handle_key);
create unique index poker_guests_token_hash_uidx on public.poker_guests (token_hash);
create index poker_guests_expires_at_idx on public.poker_guests (expires_at);

create table public.poker_rooms (
  id uuid primary key,
  join_code text not null,
  owner_guest_id uuid references public.poker_guests(id) on delete set null,
  name text not null,
  status text not null default 'lobby',
  max_players smallint not null,
  revision bigint not null default 0,
  state jsonb not null,
  hand_no integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint poker_rooms_join_code_check check (join_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$'),
  constraint poker_rooms_name_length_check check (char_length(name) between 1 and 40),
  constraint poker_rooms_status_check check (status in ('lobby', 'playing', 'closed')),
  constraint poker_rooms_max_players_check check (max_players between 2 and 6),
  constraint poker_rooms_revision_check check (revision >= 0),
  constraint poker_rooms_hand_no_check check (hand_no >= 0),
  constraint poker_rooms_state_object_check check (jsonb_typeof(state) = 'object'),
  constraint poker_rooms_expiry_check check (expires_at > created_at)
);

create unique index poker_rooms_join_code_uidx on public.poker_rooms (join_code);
create index poker_rooms_owner_updated_idx on public.poker_rooms (owner_guest_id, updated_at desc);
create index poker_rooms_status_expires_idx on public.poker_rooms (status, expires_at);

create table public.poker_room_members (
  room_id uuid not null references public.poker_rooms(id) on delete cascade,
  guest_id uuid not null references public.poker_guests(id) on delete cascade,
  seat smallint not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, guest_id),
  constraint poker_room_members_seat_check check (seat between 0 and 5),
  constraint poker_room_members_room_seat_unique unique (room_id, seat)
);

create index poker_room_members_guest_joined_idx
  on public.poker_room_members (guest_id, joined_at desc);

create table public.poker_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (key, window_start),
  constraint poker_rate_limits_key_length_check check (char_length(key) between 1 and 160),
  constraint poker_rate_limits_hits_check check (hits > 0)
);

create index poker_rate_limits_window_start_idx
  on public.poker_rate_limits (window_start);

alter table public.poker_guests enable row level security;
alter table public.poker_rooms enable row level security;
alter table public.poker_room_members enable row level security;
alter table public.poker_rate_limits enable row level security;

revoke all on table public.poker_guests from anon, authenticated;
revoke all on table public.poker_rooms from anon, authenticated;
revoke all on table public.poker_room_members from anon, authenticated;
revoke all on table public.poker_rate_limits from anon, authenticated;

grant all on table public.poker_guests to service_role;
grant all on table public.poker_rooms to service_role;
grant all on table public.poker_room_members to service_role;
grant all on table public.poker_rate_limits to service_role;

create or replace function public.poker_consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_key is null or char_length(p_key) < 1 or char_length(p_key) > 160 then
    raise exception 'invalid rate-limit key';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate-limit settings';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.poker_rate_limits (key, window_start, hits)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
  do update set hits = public.poker_rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

create or replace function public.poker_create_room(
  p_room_id uuid,
  p_join_code text,
  p_owner_guest_id uuid,
  p_name text,
  p_max_players integer,
  p_state jsonb,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.poker_guests
    where id = p_owner_guest_id and expires_at > clock_timestamp()
  ) then
    raise exception 'guest unavailable';
  end if;
  if p_state->>'roomId' is distinct from p_room_id::text
    or (p_state->>'revision')::bigint <> 0
    or p_state->>'ownerAccountId' is distinct from p_owner_guest_id::text
    or jsonb_array_length(p_state->'seats') <> 1
  then
    raise exception 'invalid initial room state';
  end if;

  insert into public.poker_rooms (
    id, join_code, owner_guest_id, name, status, max_players,
    revision, state, hand_no, expires_at
  )
  values (
    p_room_id, p_join_code, p_owner_guest_id, p_name, 'lobby',
    p_max_players, 0, p_state, 0, p_expires_at
  );

  insert into public.poker_room_members (room_id, guest_id, seat)
  values (p_room_id, p_owner_guest_id, 0);

  return true;
end;
$$;

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

  if v_seat is null or v_seat < 0 or v_seat > 5 then
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
    and expires_at > clock_timestamp();

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return false;
  end if;

  insert into public.poker_room_members (room_id, guest_id, seat)
  values (p_room_id, p_guest_id, v_seat);

  return true;
end;
$$;

create or replace function public.poker_commit_room_state(
  p_room_id uuid,
  p_guest_id uuid,
  p_expected_revision bigint,
  p_next_state jsonb,
  p_status text,
  p_hand_no integer,
  p_new_owner_guest_id uuid,
  p_remove_member boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if not exists (
    select 1 from public.poker_room_members
    where room_id = p_room_id and guest_id = p_guest_id
  ) then
    return false;
  end if;

  if p_next_state->>'roomId' is distinct from p_room_id::text
    or (p_next_state->>'revision')::bigint <> p_expected_revision + 1
    or p_next_state->>'ownerAccountId' is distinct from p_new_owner_guest_id::text
  then
    raise exception 'invalid committed room state';
  end if;

  update public.poker_rooms
  set
    owner_guest_id = p_new_owner_guest_id,
    status = p_status,
    revision = p_expected_revision + 1,
    state = p_next_state,
    hand_no = p_hand_no,
    updated_at = clock_timestamp()
  where id = p_room_id
    and revision = p_expected_revision
    and expires_at > clock_timestamp();

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return false;
  end if;

  if p_remove_member then
    delete from public.poker_room_members
    where room_id = p_room_id and guest_id = p_guest_id;
  end if;

  return true;
end;
$$;

revoke execute on function public.poker_consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.poker_create_room(uuid, text, uuid, text, integer, jsonb, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.poker_join_room(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke execute on function public.poker_commit_room_state(uuid, uuid, bigint, jsonb, text, integer, uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.poker_consume_rate_limit(text, integer, integer)
  to service_role;
grant execute on function public.poker_create_room(uuid, text, uuid, text, integer, jsonb, timestamptz)
  to service_role;
grant execute on function public.poker_join_room(uuid, uuid, bigint, jsonb)
  to service_role;
grant execute on function public.poker_commit_room_state(uuid, uuid, bigint, jsonb, text, integer, uuid, boolean)
  to service_role;
