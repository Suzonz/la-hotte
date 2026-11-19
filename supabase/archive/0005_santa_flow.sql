-- La Hotte : Secret Santa, parcours final.
--   - « Tirage déjà fait » : seule la personne qui a tiré le papier (ou son parent)
--     indique à qui elle offre. L'organisateur ne saisit rien pour les autres.
--   - L'organisateur voit QUI n'a pas encore indiqué sa personne (jamais les paires).
--   - Après le tirage, la liste des participants ne change plus directement :
--       retirer quelqu'un  → santa_remove_participant() raccroche la chaîne
--                            (une seule personne change de destinataire, et elle est prévenue) ;
--       ajouter quelqu'un  → il faut recommencer le tirage (sinon on dévoilerait un tirage).

-- Set when the server had to change someone's draw (they get a notice).
alter table public.santa_pairs add column changed_at timestamptz;

-- ---------------------------------------------------------------- typing a name in

drop policy santa_pairs_insert on public.santa_pairs;
create policy santa_pairs_insert on public.santa_pairs for insert to authenticated
  with check (
    entered_by = auth.uid()
    and santa_mode(santa_id) = 'manual'
    and is_santa_participant(santa_id, giver_id)
    and is_santa_participant(santa_id, receiver_id)
    and manages(giver_id));

-- ---------------------------------------------------------------- participants list

create function public.santa_has_pairs(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from santa_pairs where santa_id = s);
$$;

drop policy santa_participants_insert on public.santa_participants;
create policy santa_participants_insert on public.santa_participants for insert to authenticated
  with check (
    santa_organizer(santa_id) = auth.uid()
    and not santa_has_pairs(santa_id)
    and person_in_group(person_id, santa_group(santa_id)));

drop policy santa_participants_delete on public.santa_participants;
create policy santa_participants_delete on public.santa_participants for delete to authenticated
  using (santa_organizer(santa_id) = auth.uid() and not santa_has_pairs(santa_id));

-- ---------------------------------------------------------------- who still has to type their name

create function public.santa_missing(s uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.person_id
  from santa_participants p
  where p.santa_id = s
    and santa_organizer(s) = auth.uid()
    and not exists (select 1 from santa_pairs x where x.santa_id = s and x.giver_id = p.person_id);
$$;

-- ---------------------------------------------------------------- removing someone after the draw

create function public.santa_excluded(s uuid, a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from santa_exclusions e
                 where e.santa_id = s and ((e.a = a and e.b = b) or (e.a = b and e.b = a)));
$$;

-- Takes `p` out. If names are already drawn, whoever gave to `p` now gives to
-- the person `p` gave to; when that is impossible (they would draw themselves,
-- or an exclusion forbids it), a second pair is rewired. Returns how many
-- people got a new person.
create function public.santa_remove_participant(s uuid, p uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n_part     int;
  n_pairs    int;
  giver_to_p uuid;   -- A, who gave to p
  p_gave_to  uuid;   -- B, whom p gave to
  other      record; -- C → D, used when A → B is impossible
  mode_now   text := santa_mode(s);
begin
  if santa_organizer(s) is distinct from auth.uid() then
    raise exception 'Seul l''organisateur peut modifier les participants';
  end if;
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

  -- Removing the participant removes both of their pairs (cascade).
  delete from santa_participants where santa_id = s and person_id = p;

  if giver_to_p <> p_gave_to and not santa_excluded(s, giver_to_p, p_gave_to) then
    insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by, changed_at)
    values (s, giver_to_p, p_gave_to,
            case when mode_now = 'manual' then person_account(giver_to_p) end, now());
    return 1;
  end if;

  -- A → B is impossible: find C → D so that A → D and C → B both work.
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

-- ---------------------------------------------------------------- access

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.santa_has_pairs(uuid), public.santa_missing(uuid),
  public.santa_excluded(uuid, uuid, uuid), public.santa_remove_participant(uuid, uuid)
  to authenticated;
