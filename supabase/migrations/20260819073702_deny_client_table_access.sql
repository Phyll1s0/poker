create policy poker_guests_deny_client_access
on public.poker_guests
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy poker_rooms_deny_client_access
on public.poker_rooms
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy poker_room_members_deny_client_access
on public.poker_room_members
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy poker_rate_limits_deny_client_access
on public.poker_rate_limits
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
