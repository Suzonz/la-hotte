// The daily e-mail (migration 0004): what goes in it — and, above all, what never does.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const U = {
  alice: '00000000-0000-4000-8000-0000000000b1',
  bob:   '00000000-0000-4000-8000-0000000000b2',
  chloe: '00000000-0000-4000-8000-0000000000b3',
};
const NAMES = { alice: 'Alice', bob: 'Bob', chloe: 'Chloé' };
const ids = {};

async function as(user, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U[user]}', false); set role authenticated;`);
  try { return await fn((sql, params) => db.query(sql, params)); }
  finally { await db.exec('reset role'); }
}
const rows = async (user, sql, params) => (await as(user, q => q(sql, params))).rows;
const fails = async (user, sql, params) => { try { await as(user, q => q(sql, params)); } catch { return true; } return false; };
const admin = async (sql, params) => (await db.query(sql, params)).rows;
const digests = async () => Object.fromEntries((await admin("select * from build_digests('https://la-hotte.test')"))
  .map(d => [Object.keys(U).find(k => U[k] === d.user_id), d]));

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
  `);
  for (const f of readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort()) {
    await db.exec(readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8'));
  }
  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ${Object.entries(U).map(([k, u]) => `('${u}', '${k}@exemple.fr')`).join(',')};
  `);
  for (const [k, uid] of Object.entries(U)) {
    ids[k] = (await rows(k, 'insert into persons (user_id, name) values ($1, $2) returning id', [uid, NAMES[k]]))[0].id;
  }
  ids.fam = (await rows('alice', "insert into groups (name) values ('Famille') returning id"))[0].id;
  const code = (await rows('alice', 'select invite_code from groups where id = $1', [ids.fam]))[0].invite_code;
  await rows('bob', 'select join_group($1)', [code]);
  await rows('chloe', 'select join_group($1)', [code]);
});

test("rejoindre par un lien n'envoie rien ; être ajouté par quelqu'un, oui", async () => {
  assert.equal((await admin('select * from notifications')).length, 0);
  ids.work = (await rows('chloe', "insert into groups (name) values ('Collègues') returning id"))[0].id;
  await rows('chloe', 'insert into group_members (group_id, user_id, added_by) values ($1, $2, $3)', [ids.work, U.bob, U.chloe]);
  const n = await admin("select * from notifications where user_id = $1 and kind = 'added_to_group'", [U.bob]);
  assert.equal(n.length, 1);
});

test('une envie choisie puis modifiée ou retirée : seul celui qui l’a choisie est prévenu', async () => {
  const w = (await rows('bob', "insert into wishes (person_id, title) values ($1, 'Écharpe') returning id", [ids.bob]))[0].id;
  await rows('bob', 'insert into wish_groups values ($1, $2)', [w, ids.fam]);
  await rows('alice', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.bob, w]);
  assert.equal((await admin('select * from notifications where user_id = $1', [U.bob])).filter(n => n.kind !== 'added_to_group').length, 0,
    'Bob ne reçoit RIEN quand on lui réserve un cadeau');

  await rows('bob', "update wishes set note = 'rouge' where id = $1", [w]);
  await rows('bob', 'update wishes set received_at = now() where id = $1', [w]);   // not a change worth an e-mail
  assert.deepEqual((await admin('select kind from notifications where user_id = $1', [U.alice])).map(n => n.kind), ['wish_changed']);
  await rows('bob', 'update wishes set received_at = null where id = $1', [w]);   // a received envie leaving is not « retirée »
  await rows('bob', 'update wishes set removed = true where id = $1', [w]);
  assert.deepEqual((await admin('select kind from notifications where user_id = $1 order by kind', [U.alice])).map(n => n.kind), ['wish_changed', 'wish_removed']);
});

test('tirage du Secret Santa : chacun est prévenu, sans le nom de sa personne', async () => {
  ids.santa = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, 'Noël', 'draw', current_date + 7, now() + interval '8 days') returning id`, [ids.fam]))[0].id;
  for (const p of ['alice', 'bob', 'chloe']) await rows('alice', 'insert into santa_participants values ($1, $2)', [ids.santa, ids[p]]);
  await rows('alice', 'select santa_draw($1)', [ids.santa]);
  for (const u of Object.values(U)) {
    assert.equal((await admin("select * from notifications where user_id = $1 and kind = 'santa_drawn'", [u])).length, 1);
  }
});

test("le contenu des e-mails : utile, et jamais de secret", async () => {
  const d = await digests();
  assert.ok(d.alice.html.includes('Bob a modifié « Écharpe »'));
  assert.ok(d.alice.html.includes('Bob a retiré « Écharpe »'));
  assert.ok(d.bob.html.includes('Chloé t’a ajouté au groupe « Collègues »'));
  assert.ok(d.alice.html.includes('https://la-hotte.test'));
  for (const k of Object.keys(U)) {
    const html = d[k].html;
    assert.ok(html.includes('Le tirage du Secret Santa « Noël » (Famille) est fait : découvre dans La Hotte à qui tu offres un cadeau.'), k);
    assert.ok(!/tu offres à|t’offre|réservé pour toi|a réservé/i.test(html), `aucun secret dans l’e-mail de ${k}`);
    assert.ok(html.includes('Plus qu’une semaine avant l’échange du Secret Santa « Noël »'), `rappel J-7 pour ${k}`);
  }
});

test('« complet » coupe le rappel ; e-mails désactivés : rien', async () => {
  await rows('alice', 'insert into santa_status (santa_id, giver_id, done) values ($1, $2, true)', [ids.santa, ids.alice]);
  await rows('chloe', 'update persons set email_digest = false where id = $1', [ids.chloe]);
  const d = await digests();
  assert.ok(!d.alice.html.includes('Plus qu’une semaine'), 'plus de rappel pour Alice');
  assert.equal(d.chloe, undefined, 'Chloé ne reçoit rien');
});

test("seul le serveur fabrique et envoie les e-mails ; chacun ne voit que ses notifications", async () => {
  assert.ok(await fails('alice', "select * from build_digests('x')"));
  assert.ok(await fails('alice', 'select send_digests()'));
  const mine = await rows('alice', 'select user_id from notifications');
  assert.ok(mine.length > 0 && mine.every(n => n.user_id === U.alice));
});
