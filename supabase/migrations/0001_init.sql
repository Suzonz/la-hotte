-- La Hotte : schéma et règles de confidentialité.
--
-- Toute la confidentialité est appliquée ici, par Postgres (Row Level Security),
-- et non par l'interface : une personne ne reçoit jamais, même en fouillant
-- le réseau, une réservation faite pour elle, ni les envies d'un groupe dont
-- elle n'est pas membre.
--
-- Vocabulaire
--   person      : quelqu'un qui a une liste. Soit un compte (user_id),
--                 soit un enfant sans compte géré par un parent (manager_id).
--   group       : « Famille », « Collègues »… Ses membres sont des comptes.
--   wish        : une envie. Elle appartient à une person et est rangée
--                 dans un ou plusieurs groupes (wish_groups).
--   claim       : « je l'offre » (buy), « je participe » (part) ou un cadeau
--                 hors liste (other).

-- ---------------------------------------------------------------- tables

create table public.persons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users (id) on delete cascade,
  manager_id  uuid references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  created_at  timestamptz not null default now(),
  constraint persons_account_or_kid check ((user_id is null) <> (manager_id is null))
);
create index persons_manager_idx on public.persons (manager_id);

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 50),
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invite_code  text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at   timestamptz not null default now()
);

create table public.group_members (
  group_id    uuid not null references public.groups (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  added_by    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.wishes (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.persons (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  link        text check (link is null or link ~* '^https?://'),
  price       numeric(10, 2) check (price is null or price > 0),
  stars       smallint not null default 2 check (stars between 1 and 3),
  note        text not null default '' check (char_length(note) <= 400),
  removed     boolean not null default false,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz not null default now()
);
create index wishes_person_idx on public.wishes (person_id);

create table public.wish_groups (
  wish_id   uuid not null references public.wishes (id) on delete cascade,
  group_id  uuid not null references public.groups (id) on delete cascade,
  primary key (wish_id, group_id)
);
create index wish_groups_group_idx on public.wish_groups (group_id);

create table public.claims (
  id            uuid primary key default gen_random_uuid(),
  claimer_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id  uuid not null references public.persons (id) on delete cascade,
  wish_id       uuid references public.wishes (id) on delete cascade,
  kind          text not null check (kind in ('buy', 'part', 'other')),
  amount        numeric(10, 2) check (amount is null or amount > 0),
  note          text not null default '' check (char_length(note) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint claims_wish_matches_kind check ((kind = 'other') = (wish_id is null)),
  constraint claims_part_has_amount check (kind <> 'part' or amount is not null)
);
create index claims_recipient_idx on public.claims (recipient_id);
-- One claim per person per wish, and at most one « je l'offre » per wish.
create unique index claims_one_per_claimer on public.claims (claimer_id, wish_id) where wish_id is not null;
create unique index claims_one_buyer on public.claims (wish_id) where kind = 'buy';

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER so the policies below can look at other rows without
-- recursing into their own RLS checks.

create function public.is_member(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = g and user_id = u);
$$;

create function public.shares_group(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(a = b, false) or exists (
    select 1 from group_members m1
    join group_members m2 on m2.group_id = m1.group_id
    where m1.user_id = a and m2.user_id = b);
$$;

-- The account behind a person: themself, or the parent of a child.
create function public.person_account(p uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(user_id, manager_id) from persons where id = p;
$$;

create function public.manages(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from persons where id = p and (user_id = auth.uid() or manager_id = auth.uid()));
$$;

create function public.is_me(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from persons where id = p and user_id = auth.uid());
$$;

create function public.can_see_person(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and shares_group(auth.uid(), person_account(p));
$$;

create function public.group_creator(g uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select created_by from groups where id = g;
$$;

create function public.wish_person(w uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select person_id from wishes where id = w;
$$;

-- A wish is visible to whoever manages it, and to members of a group it is
-- filed in, provided its owner (or the child's parent) is still in that group.
create function public.can_see_wish(w uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wishes x
    where x.id = w
      and (manages(x.person_id) or exists (
        select 1 from wish_groups wg
        where wg.wish_id = x.id
          and is_member(wg.group_id, auth.uid())
          and is_member(wg.group_id, person_account(x.person_id)))));
$$;

-- ---------------------------------------------------------------- triggers

-- The creator of a group is its first member.
create function public.add_creator_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, added_by)
  values (new.id, new.created_by, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;
create trigger groups_add_creator after insert on public.groups
for each row execute function public.add_creator_as_member();

-- A wish's content change is dated, so buyers see « modifié depuis ton choix ».
create function public.touch_wish() returns trigger
language plpgsql as $$
begin
  new.person_id := old.person_id;
  new.created_at := old.created_at;
  if (new.title, new.link, new.price, new.stars, new.note, new.removed)
     is distinct from (old.title, old.link, old.price, old.stars, old.note, old.removed) then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
create trigger wishes_touch before update on public.wishes
for each row execute function public.touch_wish();

create function public.touch_claim() returns trigger
language plpgsql as $$
begin
  new.claimer_id := old.claimer_id;
  new.recipient_id := old.recipient_id;
  new.wish_id := old.wish_id;
  new.kind := old.kind;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger claims_touch before update on public.claims
for each row execute function public.touch_claim();

-- Nobody can turn their own person into someone else's, or a child into an account.
create function public.lock_person_owner() returns trigger
language plpgsql as $$
begin
  new.user_id := old.user_id;
  new.manager_id := old.manager_id;
  return new;
end;
$$;
create trigger persons_lock_owner before update on public.persons
for each row execute function public.lock_person_owner();

-- invite_code only changes through regenerate_invite(), which raises this flag.
create function public.lock_group_owner() returns trigger
language plpgsql as $$
begin
  new.created_by := old.created_by;
  if current_setting('la_hotte.regenerating', true) is distinct from 'on' then
    new.invite_code := old.invite_code;
  end if;
  return new;
end;
$$;
create trigger groups_lock_owner before update on public.groups
for each row execute function public.lock_group_owner();

-- ---------------------------------------------------------------- row level security

alter table public.persons       enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.wishes        enable row level security;
alter table public.wish_groups   enable row level security;
alter table public.claims        enable row level security;

-- persons: you see yourself, your children, and the people (and their
-- children) you share at least one group with.
-- (The direct column checks let a freshly inserted row be returned: helper
-- functions cannot see a row that the current statement is still inserting.)
create policy persons_select on public.persons for select to authenticated
  using (user_id = auth.uid() or manager_id = auth.uid() or can_see_person(id));
create policy persons_insert on public.persons for insert to authenticated
  with check ((user_id = auth.uid() and manager_id is null) or (manager_id = auth.uid() and user_id is null));
create policy persons_update on public.persons for update to authenticated
  using (manages(id)) with check (manages(id));
create policy persons_delete on public.persons for delete to authenticated
  using (manager_id = auth.uid());

-- groups: members see them; only the creator renames or deletes.
create policy groups_select on public.groups for select to authenticated
  using (created_by = auth.uid() or is_member(id, auth.uid()));
create policy groups_insert on public.groups for insert to authenticated
  with check (created_by = auth.uid());
create policy groups_update on public.groups for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy groups_delete on public.groups for delete to authenticated
  using (created_by = auth.uid());

-- group_members: members see each other. A member may add someone they
-- already share another group with (joining by link goes through join_group).
-- You can leave; the creator can remove anyone but themself; whoever added
-- a person can remove that person.
create policy members_select on public.group_members for select to authenticated
  using (is_member(group_id, auth.uid()));
create policy members_insert on public.group_members for insert to authenticated
  with check (
    added_by = auth.uid()
    and user_id <> auth.uid()
    and is_member(group_id, auth.uid())
    and shares_group(auth.uid(), user_id));
create policy members_delete on public.group_members for delete to authenticated
  using (
    user_id = auth.uid()
    or ((group_creator(group_id) = auth.uid() or added_by = auth.uid())
        and user_id <> group_creator(group_id)));

-- wishes: no hard delete, only « removed » so buyers get warned.
create policy wishes_select on public.wishes for select to authenticated
  using (manages(person_id) or can_see_wish(id));
create policy wishes_insert on public.wishes for insert to authenticated
  with check (manages(person_id));
create policy wishes_update on public.wishes for update to authenticated
  using (manages(person_id)) with check (manages(person_id));

-- wish_groups: you only learn about groups you belong to.
create policy wish_groups_select on public.wish_groups for select to authenticated
  using (is_member(group_id, auth.uid()) and can_see_wish(wish_id));
create policy wish_groups_insert on public.wish_groups for insert to authenticated
  with check (manages(wish_person(wish_id)) and is_member(group_id, auth.uid()));
create policy wish_groups_delete on public.wish_groups for delete to authenticated
  using (manages(wish_person(wish_id)));

-- claims: THE rule of the app. You always see your own claims. You see
-- other people's claims for someone you can see — except when that someone
-- is you. A parent does see the claims made for their child.
create policy claims_select on public.claims for select to authenticated
  using (
    claimer_id = auth.uid()
    or (not is_me(recipient_id)
        and can_see_person(recipient_id)
        and (wish_id is null or can_see_wish(wish_id))));
create policy claims_insert on public.claims for insert to authenticated
  with check (
    claimer_id = auth.uid()
    and not is_me(recipient_id)
    and can_see_person(recipient_id)
    and (wish_id is null
         or (can_see_wish(wish_id)
             and wish_person(wish_id) = recipient_id
             and not exists (select 1 from wishes w where w.id = wish_id and w.removed))));
create policy claims_update on public.claims for update to authenticated
  using (claimer_id = auth.uid()) with check (claimer_id = auth.uid());
create policy claims_delete on public.claims for delete to authenticated
  using (claimer_id = auth.uid());

-- ---------------------------------------------------------------- invitations

-- What an invite link points to (group name, who created it).
create function public.invite_info(code text)
returns table (group_id uuid, group_name text, creator_name text, already_member boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.name,
         (select p.name from persons p where p.user_id = g.created_by),
         is_member(g.id, auth.uid())
  from groups g
  where g.invite_code = code and auth.uid() is not null;
$$;

create function public.join_group(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  select id into gid from groups where invite_code = code;
  if gid is null then
    raise exception 'Lien d''invitation invalide';
  end if;
  insert into group_members (group_id, user_id, added_by)
  values (gid, auth.uid(), auth.uid())
  on conflict do nothing;
  return gid;
end;
$$;

-- The creator can replace the link, e.g. after removing someone.
create function public.regenerate_invite(g uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text := replace(gen_random_uuid()::text, '-', '');
  n int;
begin
  perform set_config('la_hotte.regenerating', 'on', true);
  update groups set invite_code = code where id = g and created_by = auth.uid();
  get diagnostics n = row_count;
  perform set_config('la_hotte.regenerating', 'off', true);
  if n = 0 then
    raise exception 'Seul le créateur du groupe peut changer le lien';
  end if;
  return code;
end;
$$;

revoke execute on function public.invite_info(text), public.join_group(text), public.regenerate_invite(uuid) from public, anon;
grant execute on function public.invite_info(text), public.join_group(text), public.regenerate_invite(uuid) to authenticated;
