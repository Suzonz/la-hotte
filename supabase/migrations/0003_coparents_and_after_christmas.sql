-- La Hotte : deux parents pour un enfant, et l'après-Noël.

-- ================================================================ co-parents
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

-- Every account behind a person: themself, or all the parents of a child.
create function public.person_accounts(p uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from persons where id = p and user_id is not null
  union select manager_id from persons where id = p and manager_id is not null
  union select user_id from person_managers where person_id = p;
$$;

create or replace function public.manages(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() in (select person_accounts(p));
$$;

-- You see a child if you share a group with any of its parents.
create or replace function public.can_see_person(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from person_accounts(p) a where shares_group(auth.uid(), a));
$$;

create or replace function public.person_in_group(p uuid, g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from person_accounts(p) a where is_member(g, a));
$$;

create or replace function public.can_see_wish(w uuid) returns boolean
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

-- user_id never changes; manager_id only when a parent hands the child over.
create or replace function public.lock_person_owner() returns trigger
language plpgsql as $$
begin
  new.user_id := old.user_id;
  if current_setting('la_hotte.transferring', true) is distinct from 'on' then
    new.manager_id := old.manager_id;
  end if;
  return new;
end;
$$;

-- Any parent may delete a child's list.
drop policy persons_delete on public.persons;
create policy persons_delete on public.persons for delete to authenticated
  using (manager_id is not null and manages(id));

alter table public.person_managers enable row level security;
create policy person_managers_select on public.person_managers for select to authenticated
  using (manages(person_id) or can_see_person(person_id));
-- A parent adds someone they already share a group with (an account, not a child).
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

-- ================================================================ after Christmas

alter table public.wishes add column received_at timestamptz;   -- « Reçu ✓ », set by its owner
alter table public.claims add column offered_at timestamptz;    -- « Offert ✓ », set by the giver

-- Nobody reserves something already received (nor removed).
drop policy claims_insert on public.claims;
create policy claims_insert on public.claims for insert to authenticated
  with check (
    claimer_id = auth.uid()
    and not is_me(recipient_id)
    and can_see_person(recipient_id)
    and (wish_id is null
         or (can_see_wish(wish_id)
             and wish_person(wish_id) = recipient_id
             and not exists (select 1 from wishes w where w.id = wish_id and (w.removed or w.received_at is not null)))));

-- « Préparer l'année prochaine » : my received envies (and my children's) leave
-- the lists, and the gifts I marked as given are cleared from « Ce que j'offre ».
create function public.new_season() returns json
language plpgsql security definer set search_path = public as $$
declare
  n_wishes int;
  n_claims int;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  update wishes set removed = true
  where received_at is not null and not removed and manages(person_id);
  get diagnostics n_wishes = row_count;
  delete from claims where claimer_id = auth.uid() and offered_at is not null;
  get diagnostics n_claims = row_count;
  return json_build_object('wishes', n_wishes, 'claims', n_claims);
end;
$$;

-- ================================================================ deleting an account, with co-parents
-- Same as before, plus: a child who has another parent stays, with that parent.

create or replace function public.delete_my_account() returns void
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

-- ================================================================ access

revoke all on table public.person_managers from anon;
grant select, insert, delete on table public.person_managers to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.santa_unlink_participant(uuid, uuid) from authenticated;
grant execute on function
  public.person_accounts(uuid), public.kid_remove_manager(uuid, uuid), public.new_season(),
  public.manages(uuid), public.can_see_person(uuid), public.person_in_group(uuid, uuid), public.can_see_wish(uuid),
  public.delete_my_account()
  to authenticated;

-- Live updates for the new table too.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'person_managers') then
    alter publication supabase_realtime add table public.person_managers;
  end if;
end;
$$;
