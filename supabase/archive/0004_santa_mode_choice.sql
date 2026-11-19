-- La Hotte : le type de Secret Santa n'a pas de valeur par défaut.
-- Tant que l'organisateur n'a pas choisi (« tirage à faire » ou « tirage déjà fait »),
-- mode est vide : ni tirage au sort ni saisie de nom ne sont possibles.

alter table public.santas alter column mode drop default;
alter table public.santas alter column mode drop not null;

-- Les Secret Santa créés avant ce choix et encore sans tirage repartent sans type.
update public.santas s
set mode = null
where not exists (select 1 from public.santa_pairs p where p.santa_id = s.id);
