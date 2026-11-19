-- La Hotte : Secret Santa.
--
-- Un Secret Santa appartient à un groupe. L'organisateur choisit les
-- participants (membres du groupe et leurs enfants), d'éventuelles
-- exclusions (un couple ne se tire pas entre eux), puis :
--   - lance un tirage au sort fait par le serveur : personne, pas même
--     l'organisateur, ne voit les paires ;
--   - et/ou laisse chacun saisir le nom qu'il a tiré sur papier ;
--   - et/ou saisit lui-même les paires (il les connaît alors).
-- Chacun ne voit que SON tirage (un parent voit aussi ceux de ses enfants)
-- jusqu'à la date de révélation ; ensuite tous les membres du groupe voient tout.

create table public.santas (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  budget      numeric(10, 2) check (budget is null or budget > 0),
  event_date  date not null,
  reveal_at   timestamptz not null,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index santas_group_idx on public.santas (group_id);

create table public.santa_participants (
  santa_id   uuid not null references public.santas (id) on delete cascade,
  person_id  uuid not null references public.persons (id) on delete cascade,
  primary key (santa_id, person_id)
);

create table public.santa_exclusions (
  santa_id  uuid not null,
  a         uuid not null,
  b         uuid not null,
  primary key (santa_id, a, b),
  check (a <> b),
  foreign key (santa_id, a) references public.santa_participants (santa_id, person_id) on delete cascade,
  foreign key (santa_id, b) references public.santa_participants (santa_id, person_id) on delete cascade
);

create table public.santa_pairs (
  santa_id     uuid not null,
  giver_id     uuid not null,
  receiver_id  uuid not null,
  -- who typed it in: the giver's account (paper draw), the organiser, or null (server draw)
  entered_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (santa_id, giver_id),
  unique (santa_id, receiver_id),
  check (giver_id <> receiver_id),
  foreign key (santa_id, giver_id) references public.santa_participants (santa_id, person_id) on delete cascade,
  foreign key (santa_id, receiver_id) references public.santa_participants (santa_id, person_id) on delete cascade
);

-- ---------------------------------------------------------------- helpers

create function public.santa_group(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from santas where id = s;
$$;

create function public.santa_organizer(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select created_by from santas where id = s;
$$;

create function public.santa_member(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member(santa_group(s), auth.uid());
$$;

create function public.santa_revealed(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select now() >= reveal_at from santas where id = s), false);
$$;

create function public.is_santa_participant(s uuid, p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from santa_participants where santa_id = s and person_id = p);
$$;

-- A person belongs to a group through their account, or their parent's.
create function public.person_in_group(p uuid, g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member(g, person_account(p));
$$;

create function public.lock_santa_owner() returns trigger
language plpgsql as $$
begin
  new.created_by := old.created_by;
  new.group_id := old.group_id;
  return new;
end;
$$;
create trigger santas_lock_owner before update on public.santas
for each row execute function public.lock_santa_owner();

-- ---------------------------------------------------------------- row level security

alter table public.santas             enable row level security;
alter table public.santa_participants enable row level security;
alter table public.santa_exclusions   enable row level security;
alter table public.santa_pairs        enable row level security;

create policy santas_select on public.santas for select to authenticated
  using (created_by = auth.uid() or is_member(group_id, auth.uid()));
create policy santas_insert on public.santas for insert to authenticated
  with check (created_by = auth.uid() and is_member(group_id, auth.uid()));
create policy santas_update on public.santas for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy santas_delete on public.santas for delete to authenticated
  using (created_by = auth.uid());

create policy santa_participants_select on public.santa_participants for select to authenticated
  using (santa_member(santa_id));
create policy santa_participants_insert on public.santa_participants for insert to authenticated
  with check (santa_organizer(santa_id) = auth.uid() and person_in_group(person_id, santa_group(santa_id)));
create policy santa_participants_delete on public.santa_participants for delete to authenticated
  using (santa_organizer(santa_id) = auth.uid());

create policy santa_exclusions_select on public.santa_exclusions for select to authenticated
  using (santa_member(santa_id));
create policy santa_exclusions_insert on public.santa_exclusions for insert to authenticated
  with check (santa_organizer(santa_id) = auth.uid());
create policy santa_exclusions_delete on public.santa_exclusions for delete to authenticated
  using (santa_organizer(santa_id) = auth.uid());

-- THE secret: before the reveal date you only see the draw of a person you
-- manage (yourself, your child) or a pair you typed in yourself.
create policy santa_pairs_select on public.santa_pairs for select to authenticated
  using (
    manages(giver_id)
    or entered_by = auth.uid()
    or (santa_revealed(santa_id) and santa_member(santa_id)));
-- Typing a draw in: for yourself / your child, or for anyone if you organise.
create policy santa_pairs_insert on public.santa_pairs for insert to authenticated
  with check (
    entered_by = auth.uid()
    and is_santa_participant(santa_id, giver_id)
    and is_santa_participant(santa_id, receiver_id)
    and (manages(giver_id) or santa_organizer(santa_id) = auth.uid()));
-- Only what you typed in yourself; a server draw can only be undone by the
-- organiser through santa_reset() (so nobody re-picks who they get).
create policy santa_pairs_delete on public.santa_pairs for delete to authenticated
  using (entered_by = auth.uid());

-- ---------------------------------------------------------------- functions

-- Draws for everyone who has no pair yet, respecting pairs already typed in
-- and the exclusions (both ways). Only the organiser may call it.
create function public.santa_draw(s uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  givers     uuid[];
  receivers  uuid[];
  shuffled   uuid[];
  n          int;
  ok         boolean;
begin
  if santa_organizer(s) is distinct from auth.uid() then
    raise exception 'Seul l''organisateur peut lancer le tirage';
  end if;
  if (select count(*) from santa_participants where santa_id = s) < 3 then
    raise exception 'Il faut au moins 3 participants pour un Secret Santa';
  end if;

  select array_agg(p.person_id order by p.person_id) into givers
  from santa_participants p
  where p.santa_id = s and not exists (select 1 from santa_pairs x where x.santa_id = s and x.giver_id = p.person_id);
  select array_agg(p.person_id order by p.person_id) into receivers
  from santa_participants p
  where p.santa_id = s and not exists (select 1 from santa_pairs x where x.santa_id = s and x.receiver_id = p.person_id);

  n := coalesce(array_length(givers, 1), 0);
  if n = 0 then
    return 0;
  end if;

  for attempt in 1..1000 loop
    select array_agg(r order by random()) into shuffled from unnest(receivers) as r;
    ok := true;
    for i in 1..n loop
      if givers[i] = shuffled[i] or exists (
        select 1 from santa_exclusions e
        where e.santa_id = s
          and ((e.a = givers[i] and e.b = shuffled[i]) or (e.a = shuffled[i] and e.b = givers[i]))) then
        ok := false;
        exit;
      end if;
    end loop;
    if ok then
      for i in 1..n loop
        insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values (s, givers[i], shuffled[i], null);
      end loop;
      return n;
    end if;
  end loop;
  raise exception 'Tirage impossible : trop d''exclusions ou de tirages déjà saisis. Retire une exclusion ou recommence le tirage.';
end;
$$;

-- Erase every pair (the organiser cannot see them, so this goes through the server).
create function public.santa_reset(s uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if santa_organizer(s) is distinct from auth.uid() then
    raise exception 'Seul l''organisateur peut recommencer le tirage';
  end if;
  delete from santa_pairs where santa_id = s;
end;
$$;

-- How far along the draw is, without saying who has whom.
create function public.santa_progress(s uuid)
returns table (participants integer, drawn integer)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from santa_participants where santa_id = s),
         (select count(*)::int from santa_pairs where santa_id = s)
  where santa_member(s);
$$;

-- ---------------------------------------------------------------- access

revoke all on table public.santas, public.santa_participants, public.santa_exclusions, public.santa_pairs from anon;
grant select, insert, update, delete on table public.santas, public.santa_participants,
                                              public.santa_exclusions, public.santa_pairs to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.santa_group(uuid), public.santa_organizer(uuid), public.santa_member(uuid), public.santa_revealed(uuid),
  public.is_santa_participant(uuid, uuid), public.person_in_group(uuid, uuid),
  public.santa_draw(uuid), public.santa_reset(uuid), public.santa_progress(uuid)
  to authenticated;
