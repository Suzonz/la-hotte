-- La Hotte : suivi de son cadeau Secret Santa.
--   santa_gifts  : « ce cadeau que j'ai réservé est pour mon Secret Santa » (un ou plusieurs).
--   santa_status : « c'est complet » / « en cours », choisi à la main.
-- Les deux ne sont lisibles QUE par la personne qui offre (ou son parent) :
-- les autres membres voient déjà qui a réservé quoi ; s'ils voyaient la mention
-- Secret Santa, ils sauraient qui a tiré qui.

-- Small helpers (they read rows the caller may not see directly).
create function public.claim_owner(c uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select claimer_id from claims where id = c;
$$;

create function public.claim_recipient(c uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select recipient_id from claims where id = c;
$$;

-- Whom `giver` gives to in Secret Santa `s` (null if not drawn yet).
create function public.santa_receiver_of(s uuid, giver uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select receiver_id from santa_pairs where santa_id = s and giver_id = giver;
$$;

create table public.santa_gifts (
  claim_id    uuid not null references public.claims (id) on delete cascade,
  santa_id    uuid not null references public.santas (id) on delete cascade,
  giver_id    uuid not null references public.persons (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (claim_id, santa_id)
);

create table public.santa_status (
  santa_id    uuid not null references public.santas (id) on delete cascade,
  giver_id    uuid not null references public.persons (id) on delete cascade,
  done        boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (santa_id, giver_id)
);

alter table public.santa_gifts  enable row level security;
alter table public.santa_status enable row level security;

-- Tag one of MY reservations, for a Secret Santa where I (or my child) give
-- to exactly that person.
create policy santa_gifts_select on public.santa_gifts for select to authenticated
  using (manages(giver_id));
create policy santa_gifts_insert on public.santa_gifts for insert to authenticated
  with check (
    manages(giver_id)
    and claim_owner(claim_id) = auth.uid()
    and santa_receiver_of(santa_id, giver_id) = claim_recipient(claim_id));
create policy santa_gifts_delete on public.santa_gifts for delete to authenticated
  using (manages(giver_id));

create policy santa_status_select on public.santa_status for select to authenticated
  using (manages(giver_id));
create policy santa_status_insert on public.santa_status for insert to authenticated
  with check (manages(giver_id) and is_santa_participant(santa_id, giver_id));
create policy santa_status_update on public.santa_status for update to authenticated
  using (manages(giver_id)) with check (manages(giver_id));
create policy santa_status_delete on public.santa_status for delete to authenticated
  using (manages(giver_id));

revoke all on table public.santa_gifts, public.santa_status from anon;
grant select, insert, update, delete on table public.santa_gifts, public.santa_status to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.claim_owner(uuid), public.claim_recipient(uuid), public.santa_receiver_of(uuid, uuid)
  to authenticated;
