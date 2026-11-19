-- La Hotte : mises à jour en direct, et suppression de son compte.

-- ---------------------------------------------------------------- live updates
-- The app listens to changes on these tables and simply reloads what it is
-- allowed to see (RLS still decides). Inserts and updates only reach people who
-- can see the row; for deletes Supabase only sends the row's id, which tells
-- nobody anything they could not already see.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['persons', 'groups', 'group_members', 'wishes', 'wish_groups', 'claims',
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

-- ---------------------------------------------------------------- deleting one's account
-- Deleting an account removes everything that belongs to it (cascade): the
-- profile, the children's lists, the envies and the reservations. But a group or
-- a Secret Santa is shared: instead of vanishing for everyone, it is handed over
-- to another member (the one who joined first).

-- created_by is normally locked; this flag lets the hand-over through.
create or replace function public.lock_group_owner() returns trigger
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

create or replace function public.lock_santa_owner() returns trigger
language plpgsql as $$
begin
  if current_setting('la_hotte.transferring', true) is distinct from 'on' then
    new.created_by := old.created_by;
  end if;
  new.group_id := old.group_id;
  return new;
end;
$$;

-- The rewiring of santa_remove_participant(), without the organiser check, so
-- that deleting an account can use it too. Not callable from the API.
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

create or replace function public.santa_remove_participant(s uuid, p uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if santa_organizer(s) is distinct from auth.uid() then
    raise exception 'Seul l''organisateur peut modifier les participants';
  end if;
  return santa_unlink_participant(s, p);
end;
$$;

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  g      record;
  heir   uuid;
  part   record;
begin
  if me is null then
    raise exception 'Connexion requise';
  end if;

  -- Leave every Secret Santa properly (me and my children), so whoever gave to
  -- us gets someone else instead of nobody. If the chain cannot be rewired
  -- (too few people left…), the organiser will have to draw again.
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

  perform set_config('la_hotte.transferring', 'on', true);
  for g in select id from groups where created_by = me loop
    select user_id into heir from group_members
    where group_id = g.id and user_id <> me
    order by created_at, user_id limit 1;
    if heir is null then
      delete from groups where id = g.id;              -- nobody else in it
    else
      update groups set created_by = heir where id = g.id;
      update santas set created_by = heir where group_id = g.id and created_by = me;
    end if;
  end loop;
  -- Secret Santas I organise in groups created by someone else.
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

  delete from auth.users where id = me;                -- everything else follows (cascade)
end;
$$;

revoke execute on function public.delete_my_account(), public.santa_unlink_participant(uuid, uuid) from public, anon;
revoke execute on function public.santa_unlink_participant(uuid, uuid) from authenticated;
grant execute on function public.delete_my_account() to authenticated;
