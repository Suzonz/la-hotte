-- La Hotte : un e-mail récapitulatif, au plus un par jour.
--
-- Des déclencheurs notent les nouvelles dans `notifications` ; chaque matin,
-- send_digests() en fait un e-mail par personne et l'envoie par l'API de Brevo.
-- Règle d'or : aucun e-mail ne trahit un secret. On n'écrit jamais
-- « quelqu'un t'a réservé un cadeau », ni à qui on offre au Secret Santa.
--
-- Pour l'activer en production, voir le README (clé API Brevo dans Vault).

alter table public.persons add column email_digest boolean not null default true;

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

-- ---------------------------------------------------------------- what is news

-- An envie someone chose was removed or changed: tell whoever chose it
-- (not the person's own parents, who made the change).
create function public.notify_wish_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c     record;
  kind  text;
  owner text;
begin
  if new.removed and not old.removed then
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

-- ---------------------------------------------------------------- the daily e-mail

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

-- Only the server runs these.
revoke execute on function public.queue_notification(uuid, text, text, jsonb), public.build_digests(text, date),
                           public.send_digests() from public, anon, authenticated;
revoke all on table public.notifications from anon;
grant select on table public.notifications to authenticated;

-- Every morning at 7:00 UTC (8:00 in Paris in winter), where pg_cron and pg_net exist.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('la-hotte-digest', '0 7 * * *', 'select public.send_digests()');
  end if;
end;
$$;
