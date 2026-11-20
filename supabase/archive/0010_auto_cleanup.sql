-- La Hotte : les cadeaux reçus et les cadeaux offerts sont supprimés au bout d'un mois.
--
-- Remplace « Préparer l'année prochaine » : plus de bouton, le serveur fait le
-- ménage chaque matin (cleanup_finished).

-- Une envie reçue qui quitte la liste n'est pas une envie « retirée » :
-- celui qui l'avait offerte ne doit pas recevoir d'alerte.
create or replace function public.notify_wish_change() returns trigger
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

-- Le bouton « Préparer l'année prochaine » n'existe plus.
drop function public.new_season();

-- Seul le serveur fait le ménage. Les fonctions de déclencheur n'ont pas besoin
-- d'être appelables par qui que ce soit.
revoke execute on all functions in schema public from public, anon;
revoke execute on function public.cleanup_finished(), public.notify_wish_change(), public.notify_added_to_group(),
                           public.notify_santa_pair(), public.html_escape(text) from authenticated;

-- Chaque matin à 6 h UTC, là où pg_cron existe.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('la-hotte-cleanup', '0 6 * * *', 'select public.cleanup_finished()');
  end if;
end;
$$;
