-- La Hotte : schéma et règles de confidentialité.
--
-- Toute la confidentialité est appliquée ici, par Postgres (Row Level Security),
-- et non par l'interface : une personne ne reçoit jamais, même en fouillant
-- le réseau, une réservation faite pour elle, ni les envies d'un groupe dont
-- elle n'est pas membre.
--
-- Ce fichier est le schéma complet : sur un projet neuf, c'est le seul à exécuter.
-- Il remplace les dix fichiers de supabase/archive/, appliqués un par un pendant
-- le développement (le résultat est identique : vérifié par tests/schema.test.mjs).
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
  email_digest boolean not null default true,     -- the daily e-mail, on by default
  constraint persons_account_or_kid check ((user_id is null) <> (manager_id is null))
);
create index persons_manager_idx on public.persons (manager_id);

-- A child keeps its first parent in persons.manager_id; other parents are listed
-- here. All parents are equal: each one manages the list, sees its reservations,
-- and can take the other off it.
create table public.person_managers (
  person_id   uuid not null references public.persons (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  added_by    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (person_id, user_id)
);
create index person_managers_user_idx on public.person_managers (user_id);

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
  edited_at   timestamptz not null default now(),
  received_at timestamptz                          -- « Reçu ✓ », set by its owner
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
  offered_at    timestamptz,                     -- « Offert ✓ », set by the giver
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

-- Every account behind a person: themself, or all the parents of a child.
create function public.person_accounts(p uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from persons where id = p and user_id is not null
  union select manager_id from persons where id = p and manager_id is not null
  union select user_id from person_managers where person_id = p;
$$;

create function public.manages(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() in (select person_accounts(p));
$$;

create function public.is_me(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from persons where id = p and user_id = auth.uid());
$$;

-- You see a child if you share a group with any of its parents.
create function public.can_see_person(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from person_accounts(p) a where shares_group(auth.uid(), a));
$$;

-- A person belongs to a group through their account, or one of their parents'.
create function public.person_in_group(p uuid, g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from person_accounts(p) a where is_member(g, a));
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
-- filed in, provided its owner (or one of the child's parents) is still in that group.
create function public.can_see_wish(w uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wishes x
    where x.id = w
      and (manages(x.person_id) or exists (
        select 1 from wish_groups wg
        where wg.wish_id = x.id
          and is_member(wg.group_id, auth.uid())
          and person_in_group(x.person_id, wg.group_id))));
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
-- manager_id only changes when a parent hands the child over (flag below).
create function public.lock_person_owner() returns trigger
language plpgsql as $$
begin
  new.user_id := old.user_id;
  if current_setting('la_hotte.transferring', true) is distinct from 'on' then
    new.manager_id := old.manager_id;
  end if;
  return new;
end;
$$;
create trigger persons_lock_owner before update on public.persons
for each row execute function public.lock_person_owner();

-- invite_code only changes through regenerate_invite(), which raises this flag;
-- created_by only when an account is deleted (the group goes to another member).
create function public.lock_group_owner() returns trigger
language plpgsql as $$
begin
  if current_setting('la_hotte.transferring', true) is distinct from 'on' then
    new.created_by := old.created_by;
  end if;
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
alter table public.person_managers enable row level security;
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
-- Any parent may delete a child's list.
create policy persons_delete on public.persons for delete to authenticated
  using (manager_id is not null and manages(id));

-- person_managers: a parent adds someone they already share a group with
-- (an account, not a child). Any parent can take a parent off.
create policy person_managers_select on public.person_managers for select to authenticated
  using (manages(person_id) or can_see_person(person_id));
create policy person_managers_insert on public.person_managers for insert to authenticated
  with check (
    added_by = auth.uid()
    and manages(person_id)
    and exists (select 1 from persons k
                where k.id = person_managers.person_id
                  and k.manager_id is not null
                  and k.manager_id <> person_managers.user_id)
    and exists (select 1 from persons a where a.user_id = person_managers.user_id)
    and shares_group(auth.uid(), person_managers.user_id));
create policy person_managers_delete on public.person_managers for delete to authenticated
  using (manages(person_id));

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
             and not exists (select 1 from wishes w where w.id = wish_id and (w.removed or w.received_at is not null)))));
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

-- ================================================================ Secret Santa
--
-- Un Secret Santa appartient à un groupe. L'organisateur choisit son type à la
-- création, puis les participants (membres du groupe et, s'ils participent,
-- leurs enfants) :
--   draw   : « tirage à faire » — le serveur tire au sort, en respectant des
--            exclusions ; personne, pas même l'organisateur, ne voit les paires ;
--   manual : « tirage déjà fait » (papier, autre site) — seule la personne qui a
--            tiré (ou son parent) indique à qui elle offre.
-- Chacun ne voit que SON tirage (un parent voit aussi ceux de ses enfants)
-- jusqu'à la date de révélation ; ensuite tous les membres du groupe voient tout.
-- Après le tirage, la liste des participants ne change plus directement :
--   retirer quelqu'un → santa_remove_participant() raccroche la chaîne
--                        (une ou deux personnes changent de destinataire, prévenues) ;
--   ajouter quelqu'un → il faut recommencer le tirage (sinon on dévoilerait un tirage).

create table public.santas (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  -- chosen at creation; null only for rows made before the choice existed
  mode        text check (mode in ('draw', 'manual')),
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
  -- who typed it in: the giver's account (« tirage déjà fait »), or null (server draw)
  entered_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- set when the server had to change this draw (someone left): the giver gets a notice
  changed_at   timestamptz,
  primary key (santa_id, giver_id),
  unique (santa_id, receiver_id),
  check (giver_id <> receiver_id),
  foreign key (santa_id, giver_id) references public.santa_participants (santa_id, person_id) on delete cascade,
  foreign key (santa_id, receiver_id) references public.santa_participants (santa_id, person_id) on delete cascade
);

-- Private to the giver: « this reservation is (part of) my Secret Santa gift ».
-- Other members already see who reserved what; if they saw this mark, they
-- would know who drew whom.
create table public.santa_gifts (
  claim_id    uuid not null references public.claims (id) on delete cascade,
  santa_id    uuid not null references public.santas (id) on delete cascade,
  giver_id    uuid not null references public.persons (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (claim_id, santa_id)
);

-- Private to the giver: « complet » or « en cours », set by hand.
create table public.santa_status (
  santa_id    uuid not null references public.santas (id) on delete cascade,
  giver_id    uuid not null references public.persons (id) on delete cascade,
  done        boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (santa_id, giver_id)
);

-- ---------------------------------------------------------------- Secret Santa helpers

create function public.santa_group(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from santas where id = s;
$$;

create function public.santa_organizer(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select created_by from santas where id = s;
$$;

create function public.santa_mode(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select mode from santas where id = s;
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

create function public.santa_has_pairs(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from santa_pairs where santa_id = s);
$$;

create function public.santa_excluded(s uuid, a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from santa_exclusions e
                 where e.santa_id = s and ((e.a = a and e.b = b) or (e.a = b and e.b = a)));
$$;

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

-- ---------------------------------------------------------------- Secret Santa triggers

create function public.lock_santa_owner() returns trigger
language plpgsql as $$
begin
  if current_setting('la_hotte.transferring', true) is distinct from 'on' then
    new.created_by := old.created_by;
  end if;
  new.group_id := old.group_id;
  return new;
end;
$$;
create trigger santas_lock_owner before update on public.santas
for each row execute function public.lock_santa_owner();

-- The kind cannot change once names are in (it would mix both ways of drawing).
create function public.lock_santa_mode() returns trigger
language plpgsql as $$
begin
  if new.mode is distinct from old.mode and exists (select 1 from santa_pairs where santa_id = old.id) then
    raise exception 'Efface d''abord les tirages pour changer de type de Secret Santa';
  end if;
  return new;
end;
$$;
create trigger santas_lock_mode before update on public.santas
for each row execute function public.lock_santa_mode();

-- ---------------------------------------------------------------- Secret Santa row level security

alter table public.santas             enable row level security;
alter table public.santa_participants enable row level security;
alter table public.santa_exclusions   enable row level security;
alter table public.santa_pairs        enable row level security;
alter table public.santa_gifts        enable row level security;
alter table public.santa_status       enable row level security;

create policy santas_select on public.santas for select to authenticated
  using (created_by = auth.uid() or is_member(group_id, auth.uid()));
create policy santas_insert on public.santas for insert to authenticated
  with check (created_by = auth.uid() and is_member(group_id, auth.uid()));
create policy santas_update on public.santas for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy santas_delete on public.santas for delete to authenticated
  using (created_by = auth.uid());

-- Participants change freely until names exist; after that, see santa_remove_participant().
create policy santa_participants_select on public.santa_participants for select to authenticated
  using (santa_member(santa_id));
create policy santa_participants_insert on public.santa_participants for insert to authenticated
  with check (
    santa_organizer(santa_id) = auth.uid()
    and not santa_has_pairs(santa_id)
    and person_in_group(person_id, santa_group(santa_id)));
create policy santa_participants_delete on public.santa_participants for delete to authenticated
  using (santa_organizer(santa_id) = auth.uid() and not santa_has_pairs(santa_id));

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
-- « Tirage déjà fait » only: you say whom you (or your child) drew — nobody else can.
create policy santa_pairs_insert on public.santa_pairs for insert to authenticated
  with check (
    entered_by = auth.uid()
    and santa_mode(santa_id) = 'manual'
    and is_santa_participant(santa_id, giver_id)
    and is_santa_participant(santa_id, receiver_id)
    and manages(giver_id));
-- Only what you typed in yourself; a server draw can only be undone by the
-- organiser through santa_reset() (so nobody re-picks who they get).
create policy santa_pairs_delete on public.santa_pairs for delete to authenticated
  using (entered_by = auth.uid());

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

-- ---------------------------------------------------------------- Secret Santa functions

-- Draws for everyone who has no pair yet, respecting the exclusions (both ways).
-- Only the organiser may call it, only for « tirage à faire ».
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
  if santa_mode(s) is distinct from 'draw' then
    raise exception 'Ce Secret Santa a déjà été tiré ailleurs : chacun saisit son nom';
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
  raise exception 'Tirage impossible : trop d''exclusions. Retire une exclusion ou recommence le tirage.';
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

-- « Tirage déjà fait » : who has not said whom they drew yet (organiser only, never the pairs).
create function public.santa_missing(s uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.person_id
  from santa_participants p
  where p.santa_id = s
    and santa_organizer(s) = auth.uid()
    and not exists (select 1 from santa_pairs x where x.santa_id = s and x.giver_id = p.person_id);
$$;

-- Takes `p` out. If names are already drawn, whoever gave to `p` now gives to
-- the person `p` gave to; when that is impossible (they would draw themselves,
-- or an exclusion forbids it), a second pair is rewired. Returns how many
-- people got a new person. No organiser check here, so that deleting an
-- account can use it too; not callable from the API.
create function public.santa_unlink_participant(s uuid, p uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n_part     int;
  n_pairs    int;
  giver_to_p uuid;
  p_gave_to  uuid;
  other      record;
  mode_now   text := santa_mode(s);
begin
  if not is_santa_participant(s, p) then
    return 0;
  end if;
  select count(*) into n_part from santa_participants where santa_id = s;
  select count(*) into n_pairs from santa_pairs where santa_id = s;

  if n_pairs = 0 then
    delete from santa_participants where santa_id = s and person_id = p;
    return 0;
  end if;
  if n_pairs < n_part then
    raise exception 'Tout le monde n''a pas encore indiqué sa personne : attends que ce soit fait, ou efface les saisies pour recommencer.';
  end if;
  if n_part - 1 < 3 then
    raise exception 'Il faut au moins 3 participants : refais plutôt le tirage, ou supprime ce Secret Santa.';
  end if;

  select giver_id into giver_to_p from santa_pairs where santa_id = s and receiver_id = p;
  select receiver_id into p_gave_to from santa_pairs where santa_id = s and giver_id = p;
  delete from santa_participants where santa_id = s and person_id = p;   -- both pairs go (cascade)

  if giver_to_p <> p_gave_to and not santa_excluded(s, giver_to_p, p_gave_to) then
    insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by, changed_at)
    values (s, giver_to_p, p_gave_to, case when mode_now = 'manual' then person_account(giver_to_p) end, now());
    return 1;
  end if;

  select x.giver_id as c, x.receiver_id as d into other
  from santa_pairs x
  where x.santa_id = s
    and x.giver_id <> giver_to_p and x.receiver_id <> giver_to_p
    and x.receiver_id <> p_gave_to and x.giver_id <> p_gave_to
    and not santa_excluded(s, giver_to_p, x.receiver_id)
    and not santa_excluded(s, x.giver_id, p_gave_to)
  order by random()
  limit 1;
  if not found then
    raise exception 'Impossible de retirer cette personne sans refaire le tirage (à cause des exclusions).';
  end if;

  delete from santa_pairs where santa_id = s and giver_id = other.c;
  insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by, changed_at) values
    (s, giver_to_p, other.d, case when mode_now = 'manual' then person_account(giver_to_p) end, now()),
    (s, other.c,    p_gave_to, case when mode_now = 'manual' then person_account(other.c) end, now());
  return 2;
end;
$$;

create function public.santa_remove_participant(s uuid, p uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if santa_organizer(s) is distinct from auth.uid() then
    raise exception 'Seul l''organisateur peut modifier les participants';
  end if;
  return santa_unlink_participant(s, p);
end;
$$;

-- ================================================================ children with two parents

-- Take a parent off a child's list (yourself included). The first parent can be
-- taken off too: another parent then becomes the first one.
create function public.kid_remove_manager(kid uuid, u uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  first_parent uuid;
  heir         uuid;
begin
  if not manages(kid) then
    raise exception 'Tu ne gères pas cette liste';
  end if;
  select manager_id into first_parent from persons where id = kid;
  if first_parent is null then
    raise exception 'Ce n''est pas une liste d''enfant';
  end if;
  if u is distinct from first_parent then
    delete from person_managers where person_id = kid and user_id = u;
    return;
  end if;
  select user_id into heir from person_managers where person_id = kid order by created_at, user_id limit 1;
  if heir is null then
    raise exception 'Il ne resterait plus aucun parent : supprime plutôt cette liste.';
  end if;
  perform set_config('la_hotte.transferring', 'on', true);
  update persons set manager_id = heir where id = kid;
  perform set_config('la_hotte.transferring', 'off', true);
  delete from person_managers where person_id = kid and user_id = heir;
end;
$$;

-- ================================================================ deleting one's account
-- Deleting an account removes everything that belongs to it (cascade): the
-- profile, the children's lists, the envies and the reservations. But what is
-- shared stays: a child with another parent stays with that parent, and a group
-- or a Secret Santa goes to another member (the one who joined first).

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  g      record;
  heir   uuid;
  part   record;
  kid    record;
begin
  if me is null then
    raise exception 'Connexion requise';
  end if;

  perform set_config('la_hotte.transferring', 'on', true);

  -- Children with another parent are handed over to that parent.
  for kid in select id from persons where manager_id = me loop
    select user_id into heir from person_managers where person_id = kid.id and user_id <> me order by created_at, user_id limit 1;
    if heir is not null then
      update persons set manager_id = heir where id = kid.id;
      delete from person_managers where person_id = kid.id and user_id = heir;
    end if;
  end loop;

  -- Leave every Secret Santa properly (me, and the children leaving with me).
  for part in
    select sp.santa_id, sp.person_id from santa_participants sp
    join persons p on p.id = sp.person_id
    where p.user_id = me or p.manager_id = me
  loop
    begin
      perform santa_unlink_participant(part.santa_id, part.person_id);
    exception when others then
      delete from santa_participants where santa_id = part.santa_id and person_id = part.person_id;
    end;
  end loop;

  -- Shared groups and Secret Santas go to another member.
  for g in select id from groups where created_by = me loop
    select user_id into heir from group_members
    where group_id = g.id and user_id <> me
    order by created_at, user_id limit 1;
    if heir is null then
      delete from groups where id = g.id;
    else
      update groups set created_by = heir where id = g.id;
      update santas set created_by = heir where group_id = g.id and created_by = me;
    end if;
  end loop;
  for g in select s.id, s.group_id from santas s where s.created_by = me loop
    select user_id into heir from group_members
    where group_id = g.group_id and user_id <> me
    order by created_at, user_id limit 1;
    if heir is null then
      delete from santas where id = g.id;
    else
      update santas set created_by = heir where id = g.id;
    end if;
  end loop;
  perform set_config('la_hotte.transferring', 'off', true);

  delete from auth.users where id = me;
end;
$$;

-- ================================================================ the daily e-mail
-- Des déclencheurs notent les nouvelles dans `notifications` ; chaque matin,
-- send_digests() en fait un e-mail par personne et l'envoie par l'API de Brevo.
-- Règle d'or : aucun e-mail ne trahit un secret. On n'écrit jamais
-- « quelqu'un t'a réservé un cadeau », ni à qui on offre au Secret Santa.
-- Pour l'activer, voir le README (clé API Brevo dans Vault).

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('wish_removed', 'wish_changed', 'added_to_group', 'santa_drawn', 'santa_changed')),
  -- `key` identifies what it is about, so the same news is not queued twice
  key         text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index notifications_pending_idx on public.notifications (user_id) where sent_at is null;
create unique index notifications_once on public.notifications (user_id, kind, key) where sent_at is null;

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

create function public.queue_notification(u uuid, k text, ky text, p jsonb) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, key, payload) values (u, k, ky, p)
  on conflict (user_id, kind, key) where sent_at is null do update set payload = excluded.payload, created_at = now();
$$;

-- An envie someone chose was removed or changed: tell whoever chose it
-- (not the person's own parents, who made the change). An envie leaving the
-- list because it was received is not « removed »: no alert.
create function public.notify_wish_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c     record;
  kind  text;
  owner text;
begin
  if new.removed and not old.removed then
    if new.received_at is not null then
      return new;
    end if;
    kind := 'wish_removed';
  elsif new.edited_at is distinct from old.edited_at and not new.removed then
    kind := 'wish_changed';
  else
    return new;
  end if;
  select name into owner from persons where id = new.person_id;
  for c in select distinct claimer_id from claims where wish_id = new.id loop
    if c.claimer_id not in (select person_accounts(new.person_id)) then
      perform queue_notification(c.claimer_id, kind, new.id::text,
        jsonb_build_object('title', new.title, 'person', owner));
    end if;
  end loop;
  return new;
end;
$$;
create trigger wishes_notify after update on public.wishes
for each row execute function public.notify_wish_change();

-- Someone added you to a group (joining by link is your own doing: no e-mail).
create function public.notify_added_to_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.added_by is not null and new.added_by <> new.user_id then
    perform queue_notification(new.user_id, 'added_to_group', new.group_id::text,
      jsonb_build_object(
        'group', (select name from groups where id = new.group_id),
        'by', (select name from persons where user_id = new.added_by)));
  end if;
  return new;
end;
$$;
create trigger group_members_notify after insert on public.group_members
for each row execute function public.notify_added_to_group();

-- The draw is done (or your person changed): tell the giver's account(s),
-- without the name, which stays in the app.
create function public.notify_santa_pair() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a uuid;
  s record;
begin
  if new.entered_by is not null and new.changed_at is null then
    return new;                         -- typed in by the person themself
  end if;
  select sa.name, g.name as group_name into s from santas sa join groups g on g.id = sa.group_id where sa.id = new.santa_id;
  for a in select person_accounts(new.giver_id) loop
    perform queue_notification(a,
      case when new.changed_at is null then 'santa_drawn' else 'santa_changed' end,
      new.santa_id::text,
      jsonb_build_object('santa', s.name, 'group', s.group_name,
                         'for', (select name from persons where id = new.giver_id and user_id is null)));
  end loop;
  return new;
end;
$$;
create trigger santa_pairs_notify after insert on public.santa_pairs
for each row execute function public.notify_santa_pair();

create function public.html_escape(t text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

-- One e-mail per person who has news and wants e-mails. Also adds the
-- « J-7 » reminder for Secret Santas whose gift is not marked complete.
create function public.build_digests(site_url text, today date default current_date)
returns table (user_id uuid, email text, subject text, html text, notification_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
declare
  u      record;
  n      record;
  r      record;
  items  text[];
  ids    uuid[];
begin
  for u in
    select au.id, au.email, p.name
    from auth.users au join persons p on p.user_id = au.id
    where p.email_digest and au.email is not null
  loop
    items := '{}';
    ids := '{}';
    for n in select * from notifications nt where nt.user_id = u.id and nt.sent_at is null order by nt.created_at loop
      ids := ids || n.id;
      items := items || case n.kind
        when 'wish_removed' then format('%s a retiré « %s » de ses envies, alors que tu l’avais choisi.', html_escape(n.payload->>'person'), html_escape(n.payload->>'title'))
        when 'wish_changed' then format('%s a modifié « %s », que tu as choisi : vérifie les détails.', html_escape(n.payload->>'person'), html_escape(n.payload->>'title'))
        when 'added_to_group' then format('%s t’a ajouté au groupe « %s ».', html_escape(coalesce(n.payload->>'by', 'Quelqu’un')), html_escape(n.payload->>'group'))
        when 'santa_drawn' then format('Le tirage du Secret Santa « %s » (%s) est fait%s : découvre dans La Hotte à qui tu offres un cadeau.',
                                       html_escape(n.payload->>'santa'), html_escape(n.payload->>'group'),
                                       case when n.payload->>'for' is not null then ' pour ' || html_escape(n.payload->>'for') else '' end)
        when 'santa_changed' then format('Ton tirage du Secret Santa « %s » a changé, car une personne ne participe plus. Regarde dans La Hotte.', html_escape(n.payload->>'santa'))
      end;
    end loop;

    -- J-7: Secret Santas where I (or my child) give and the gift is not marked complete.
    for r in
      select distinct sa.name, sa.event_date
      from santas sa
      join santa_pairs sp on sp.santa_id = sa.id
      where sa.event_date = today + 7
        and u.id in (select person_accounts(sp.giver_id))
        and not exists (select 1 from santa_status st where st.santa_id = sa.id and st.giver_id = sp.giver_id and st.done)
    loop
      items := items || format('Plus qu’une semaine avant l’échange du Secret Santa « %s » : ton cadeau est-il prêt ?', html_escape(r.name));
    end loop;

    if array_length(items, 1) is null then
      continue;
    end if;
    user_id := u.id;
    email := u.email;
    notification_ids := ids;
    subject := case when array_length(items, 1) = 1 then 'Du nouveau dans La Hotte 🎁' else format('%s nouvelles dans La Hotte 🎁', array_length(items, 1)) end;
    html := format(
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#14241d">'
      '<h2 style="color:#1d5a43">🎁 La Hotte</h2><p>Bonjour %s,</p><ul style="padding-left:18px;line-height:1.5">%s</ul>'
      '<p style="text-align:center;margin:24px 0"><a href="%s" style="background:#1d5a43;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Ouvrir La Hotte</a></p>'
      '<p style="font-size:12px;color:#5a6a62">Tu reçois au plus un e-mail par jour. Pour ne plus en recevoir : « Mon compte » dans La Hotte.</p></div>',
      html_escape(u.name),
      (select string_agg('<li>' || i || '</li>', '') from unnest(items) as i),
      html_escape(site_url));
    return next;
  end loop;
end;
$$;

-- Sends the day's e-mails through Brevo. Needs three Vault secrets:
-- brevo_api_key, la_hotte_sender (an address validated in Brevo), la_hotte_site_url.
create function public.send_digests() returns integer
language plpgsql security definer set search_path = public as $$
declare
  api_key text;
  sender  text;
  site    text;
  d       record;
  n       int := 0;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'brevo_api_key';
  select decrypted_secret into sender  from vault.decrypted_secrets where name = 'la_hotte_sender';
  select decrypted_secret into site    from vault.decrypted_secrets where name = 'la_hotte_site_url';
  if api_key is null or sender is null or site is null then
    raise notice 'La Hotte : e-mails non configurés (secrets Vault manquants).';
    return 0;
  end if;

  for d in select * from build_digests(site) loop
    perform net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', api_key, 'content-type', 'application/json', 'accept', 'application/json'),
      body := jsonb_build_object(
        'sender', jsonb_build_object('name', 'La Hotte', 'email', sender),
        'to', jsonb_build_array(jsonb_build_object('email', d.email)),
        'subject', d.subject,
        'htmlContent', d.html));
    update notifications set sent_at = now() where id = any (d.notification_ids);
    n := n + 1;
  end loop;

  -- People who turned e-mails off: their news is simply dropped. Old ones too.
  update notifications nt set sent_at = now()
  where nt.sent_at is null
    and exists (select 1 from persons p where p.user_id = nt.user_id and not p.email_digest);
  delete from notifications where sent_at < now() - interval '30 days';
  return n;
end;
$$;

-- ================================================================ after Christmas
-- Ce qui est fini est vraiment effacé de la base, pas seulement caché :
--   1. un cadeau coché « Offert » depuis un mois compte comme reçu, même si la
--      personne n'a pas coché « Reçu » (sinon l'envie redeviendrait libre) ;
--   2. il quitte alors « Ce que j'offre » ;
--   3. une envie reçue depuis un mois est effacée, avec ses réservations ;
--   4. une envie supprimée par son propriétaire est effacée dès que plus
--      personne ne l'a choisie (tant qu'un acheteur l'a, il doit être prévenu).
create function public.cleanup_finished() returns json
language plpgsql security definer set search_path = public as $$
declare
  n_wishes int;
  n_gone   int;
  n_claims int;
begin
  update wishes w set received_at = now()
  where w.received_at is null and not w.removed
    and exists (select 1 from claims c where c.wish_id = w.id and c.offered_at < now() - interval '1 month');
  delete from claims where offered_at < now() - interval '1 month';
  get diagnostics n_claims = row_count;
  delete from wishes where received_at < now() - interval '1 month';
  get diagnostics n_wishes = row_count;
  delete from wishes w where w.removed and not exists (select 1 from claims c where c.wish_id = w.id);
  get diagnostics n_gone = row_count;
  return json_build_object('wishes', n_wishes + n_gone, 'claims', n_claims);
end;
$$;

-- ================================================================ access
-- Explicit, so the app works whether or not the Supabase project grants
-- API access to new tables automatically. Only signed-in users get in;
-- RLS above then decides which rows they see.

grant usage on schema public to authenticated;
revoke all on table public.persons, public.person_managers, public.groups, public.group_members,
                    public.wishes, public.wish_groups, public.claims,
                    public.santas, public.santa_participants, public.santa_exclusions,
                    public.santa_pairs, public.santa_gifts, public.santa_status,
                    public.notifications from anon;
grant select, insert, update, delete on table public.persons, public.groups, public.group_members,
                    public.wishes, public.wish_groups, public.claims,
                    public.santas, public.santa_participants, public.santa_exclusions,
                    public.santa_pairs, public.santa_gifts, public.santa_status to authenticated;
grant select, insert, delete on table public.person_managers to authenticated;
grant select on table public.notifications to authenticated;

-- Functions: none for visitors; for signed-in users, only those listed here.
-- The rest (triggers, e-mails, cleanup, santa_unlink_participant) only run on the server.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_member(uuid, uuid), public.shares_group(uuid, uuid), public.person_account(uuid),
  public.person_accounts(uuid), public.manages(uuid), public.is_me(uuid), public.can_see_person(uuid),
  public.group_creator(uuid), public.wish_person(uuid), public.can_see_wish(uuid),
  public.invite_info(text), public.join_group(text), public.regenerate_invite(uuid),
  public.santa_group(uuid), public.santa_organizer(uuid), public.santa_mode(uuid), public.santa_member(uuid),
  public.santa_revealed(uuid), public.is_santa_participant(uuid, uuid), public.santa_has_pairs(uuid),
  public.santa_excluded(uuid, uuid, uuid), public.person_in_group(uuid, uuid),
  public.claim_owner(uuid), public.claim_recipient(uuid), public.santa_receiver_of(uuid, uuid),
  public.santa_draw(uuid), public.santa_reset(uuid), public.santa_progress(uuid),
  public.santa_missing(uuid), public.santa_remove_participant(uuid, uuid),
  public.kid_remove_manager(uuid, uuid), public.delete_my_account()
  to authenticated;

-- ================================================================ Supabase only
-- (skipped elsewhere, e.g. in the tests)

-- Live updates: the app listens to changes on these tables and reloads what it
-- is allowed to see (RLS still decides). For deletes Supabase only sends the
-- row's id, which tells nobody anything they could not already see.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['persons', 'person_managers', 'groups', 'group_members', 'wishes', 'wish_groups', 'claims',
                             'santas', 'santa_participants', 'santa_exclusions', 'santa_pairs',
                             'santa_gifts', 'santa_status'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- Every morning: the cleanup at 6:00 UTC, the e-mail at 7:00 UTC (8:00 in Paris in winter).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('la-hotte-cleanup', '0 6 * * *', 'select public.cleanup_finished()');
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      create extension if not exists pg_net with schema extensions;
      perform cron.schedule('la-hotte-digest', '0 7 * * *', 'select public.send_digests()');
    end if;
  end if;
end;
$$;
