// Deleting one's account (delete_my_account): everything personal goes,
// shared groups and Secret Santas are handed over instead of vanishing.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const U = {
  alice: '00000000-0000-4000-8000-00000000000a',
  bob:   '00000000-0000-4000-8000-00000000000b',
  chloe: '00000000-0000-4000-8000-00000000000c',
  dan:   '00000000-0000-4000-8000-00000000000d',
};
const ids = {};

async function as(user, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ? U[user] : ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try { return await fn((sql, params) => db.query(sql, params)); }
  finally { await db.exec('reset role'); }
}
const rows = async (user, sql, params) => (await as(user, q => q(sql, params))).rows;
const admin = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
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
    insert into auth.users values ${Object.values(U).map(u => `('${u}')`).join(',')};
  `);
  for (const [name, uid] of Object.entries(U)) {
    ids[name] = (await rows(name, 'insert into persons (user_id, name) values ($1, $2) returning id', [uid, name]))[0].id;
  }
  ids.fam = (await rows('alice', "insert into groups (name) values ('Famille') returning id"))[0].id;
  ids.solo = (await rows('alice', "insert into groups (name) values ('Rien que moi') returning id"))[0].id;
  const code = (await rows('alice', 'select invite_code from groups where id = $1', [ids.fam]))[0].invite_code;
  await rows('bob', 'select join_group($1)', [code]);
  await new Promise(r => setTimeout(r, 10));
  await rows('chloe', 'select join_group($1)', [code]);
  await rows('dan', 'select join_group($1)', [code]);
  ids.kid = (await rows('alice', "insert into persons (manager_id, name) values ($1, 'Léo') returning id", [U.alice]))[0].id;
  ids.santa = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, 'Noël', 'draw', current_date, now() + interval '30 days') returning id`, [ids.fam]))[0].id;
  for (const p of ['alice', 'bob', 'chloe', 'dan']) await rows('alice', 'insert into santa_participants values ($1, $2)', [ids.santa, ids[p]]);
  await rows('alice', 'select santa_draw($1)', [ids.santa]);
  ids.bobWish = (await rows('bob', "insert into wishes (person_id, title) values ($1, 'Écharpe') returning id", [ids.bob]))[0].id;
  await rows('bob', 'insert into wish_groups values ($1, $2)', [ids.bobWish, ids.fam]);
  await rows('alice', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.bob, ids.bobWish]);
});

test("un visiteur non connecté ne peut rien supprimer", async () => {
  await assert.rejects(rows(null, 'select delete_my_account()'));
});

test('supprimer son compte : tout ce qui est à soi part, le groupe et le Secret Santa sont transmis', async () => {
  await rows('alice', 'select delete_my_account()');

  assert.equal((await admin('select * from auth.users where id = $1', [U.alice])).length, 0, 'compte supprimé');
  assert.equal((await admin('select * from persons where user_id = $1 or manager_id = $1', [U.alice])).length, 0, 'profil et enfant supprimés');
  assert.equal((await admin('select * from claims where claimer_id = $1', [U.alice])).length, 0, 'réservations supprimées');
  assert.equal((await admin('select * from groups where id = $1', [ids.solo])).length, 0, 'un groupe sans autre membre disparaît');

  const fam = (await admin('select created_by from groups where id = $1', [ids.fam]))[0];
  assert.equal(fam.created_by, U.bob, 'Famille est transmis à Bob, arrivé le premier');
  assert.equal((await admin('select created_by from santas where id = $1', [ids.santa]))[0].created_by, U.bob, 'le Secret Santa aussi');
  assert.equal((await rows('chloe', 'select * from wishes where id = $1', [ids.bobWish])).length, 1, 'les envies de Bob sont toujours là pour Chloé');

  // The Secret Santa chain was rewired: the 3 left each give once and receive once.
  const pairs = await admin('select giver_id, receiver_id from santa_pairs where santa_id = $1', [ids.santa]);
  const left = [ids.bob, ids.chloe, ids.dan].sort();
  assert.deepEqual(pairs.map(p => p.giver_id).sort(), left);
  assert.deepEqual(pairs.map(p => p.receiver_id).sort(), left);
  assert.ok(pairs.every(p => p.giver_id !== p.receiver_id));
});

test("la fonction interne de raccrochage n'est pas appelable depuis l'appli", async () => {
  await assert.rejects(rows('bob', 'select santa_unlink_participant($1, $2)', [ids.santa, ids.chloe]));
});

test('la transmission ne permet pas de voler un groupe en temps normal', async () => {
  await rows('chloe', 'update groups set created_by = $1 where id = $2', [U.chloe, ids.fam]);
  assert.equal((await admin('select created_by from groups where id = $1', [ids.fam]))[0].created_by, U.bob);
  await rows('bob', 'update groups set created_by = $1 where id = $2', [U.chloe, ids.fam]);
  assert.equal((await admin('select created_by from groups where id = $1', [ids.fam]))[0].created_by, U.bob, 'même le créateur ne peut pas changer ce champ à la main');
});
