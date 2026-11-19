-- La Hotte : deux sortes de Secret Santa, choisies à la création.
--   draw   : « tirage à faire » — le serveur tire au sort, personne ne saisit de nom.
--   manual : « tirage déjà fait » (papier, autre site) — chacun saisit le nom qu'il
--            a tiré, ou l'organisateur saisit les paires.

alter table public.santas
  add column mode text not null default 'draw' check (mode in ('draw', 'manual'));

create function public.santa_mode(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select mode from santas where id = s;
$$;

-- Typing a name in is only for a draw that already happened elsewhere.
drop policy santa_pairs_insert on public.santa_pairs;
create policy santa_pairs_insert on public.santa_pairs for insert to authenticated
  with check (
    entered_by = auth.uid()
    and santa_mode(santa_id) = 'manual'
    and is_santa_participant(santa_id, giver_id)
    and is_santa_participant(santa_id, receiver_id)
    and (manages(giver_id) or santa_organizer(santa_id) = auth.uid()));

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

create or replace function public.santa_draw(s uuid) returns integer
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

revoke execute on all functions in schema public from public, anon;
grant execute on function public.santa_mode(uuid) to authenticated;
