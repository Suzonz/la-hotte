// Two parents for a child, and the after-Christmas gestures (migration 0003).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const U = {
  mum:   '00000000-0000-4000-8000-0000000000a1',
  dad:   '00000000-0000-4000-8000-0000000000a2',
  aunt:  '00000000-0000-4000-8000-0000000000a3',
  other: '00000000-0000-4000-8000-0000000000a4',   // in no shared group
};
const ids = {};

async function as(user, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U[user]}', false); set role authenticated;`);
  try { return await fn((sql, params) => db.query(sql, params)); }
  finally { await db.exec('reset role'); }
}
const rows = async (user, sql, params) => (await as(user, q => q(sql, params))).rows;
const fails = async (user, sql, params) => { try { await as(user, q => q(sql, params)); } catch { return true; } return false; };
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
  // Mum's group « Famille » with Dad; Dad's group « Collègues de papa » with Aunt (not Mum).
  ids.fam = (await rows('mum', "insert into groups (name) values ('Famille') returning id"))[0].id;
  ids.work = (await rows('dad', "insert into groups (name) values ('Collègues de papa') returning id"))[0].id;
  const famCode = (await rows('mum', 'select invite_code from groups where id = $1', [ids.fam]))[0].invite_code;
  const workCode = (await rows('dad', 'select invite_code from groups where id = $1', [ids.work]))[0].invite_code;
  await rows('dad', 'select join_group($1)', [famCode]);
  await rows('aunt', 'select join_group($1)', [workCode]);
  ids.leo = (await rows('mum', "insert into persons (manager_id, name) values ($1, 'Léo') returning id", [U.mum]))[0].id;
});

test('un parent ajoute l’autre ; celui-ci gère alors la liste comme lui', async () => {
  assert.ok(await fails('mum', 'insert into person_managers (person_id, user_id, added_by) values ($1, $2, $3)', [ids.leo, U.other, U.mum]), 'pas quelqu’un d’inconnu');
  assert.ok(await fails('aunt', 'insert into person_managers (person_id, user_id, added_by) values ($1, $2, $3)', [ids.leo, U.aunt, U.aunt]), 'on ne s’ajoute pas soi-même');
  await rows('mum', 'insert into person_managers (person_id, user_id, added_by) values ($1, $2, $3)', [ids.leo, U.dad, U.mum]);

  // Dad files an envie for Léo in HIS group: Aunt (only in Dad's group) sees it.
  const w = (await rows('dad', "insert into wishes (person_id, title) values ($1, 'Lego') returning id", [ids.leo]))[0].id;
  await rows('dad', 'insert into wish_groups values ($1, $2)', [w, ids.work]);
  ids.lego = w;
  assert.equal((await rows('aunt', 'select * from wishes where id = $1', [w])).length, 1, 'la tante voit l’envie de Léo rangée par papa');
  assert.equal((await rows('aunt', 'select name from persons where id = $1', [ids.leo])).length, 1);
  assert.equal((await rows('mum', 'select * from wishes where id = $1', [w])).length, 1, 'maman la voit aussi');
  assert.equal((await rows('other', 'select * from wishes where id = $1', [w])).length, 0);
});

test('les deux parents voient les réservations faites pour l’enfant', async () => {
  await rows('aunt', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.leo, ids.lego]);
  assert.equal((await rows('dad', 'select * from claims where recipient_id = $1', [ids.leo])).length, 1);
  assert.equal((await rows('mum', 'select * from claims where recipient_id = $1', [ids.leo])).length, 1);
});

test('chaque parent peut retirer l’autre, jamais le dernier', async () => {
  await rows('dad', 'select kid_remove_manager($1, $2)', [ids.leo, U.mum]);
  assert.equal((await admin('select manager_id from persons where id = $1', [ids.leo]))[0].manager_id, U.dad, 'papa devient le premier parent');
  assert.equal((await rows('mum', 'select * from wishes where person_id = $1', [ids.leo])).length, 0, 'maman ne gère plus');
  assert.ok(await fails('dad', 'select kid_remove_manager($1, $2)', [ids.leo, U.dad]), 'il resterait zéro parent');
  assert.ok(await fails('mum', 'select kid_remove_manager($1, $2)', [ids.leo, U.dad]), 'maman ne peut plus rien');
  await rows('dad', 'insert into person_managers (person_id, user_id, added_by) values ($1, $2, $3)', [ids.leo, U.mum, U.dad]);
});

test('supprimer son compte : l’enfant reste avec l’autre parent', async () => {
  await rows('dad', 'select delete_my_account()');
  const leo = await admin('select manager_id from persons where id = $1', [ids.leo]);
  assert.equal(leo.length, 1, 'Léo est toujours là');
  assert.equal(leo[0].manager_id, U.mum);
});

test('« Reçu » : plus réservable ; « Préparer l’année prochaine » range tout', async () => {
  const w = (await rows('mum', "insert into wishes (person_id, title) values ($1, 'Plaid') returning id", [ids.mum]))[0].id;
  await rows('mum', 'insert into wish_groups values ($1, $2)', [w, ids.fam]);
  const kept = (await rows('mum', "insert into wishes (person_id, title) values ($1, 'Livre') returning id", [ids.mum]))[0].id;
  // Someone in Famille to give: Aunt joins it.
  const famCode = (await rows('mum', 'select invite_code from groups where id = $1', [ids.fam]))[0].invite_code;
  await rows('aunt', 'select join_group($1)', [famCode]);
  const c = (await rows('aunt', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy') returning id", [ids.mum, w]))[0].id;

  const before = (await rows('mum', 'select edited_at from wishes where id = $1', [w]))[0].edited_at;
  await rows('mum', 'update wishes set received_at = now() where id = $1', [w]);
  assert.equal((await rows('mum', 'select edited_at from wishes where id = $1', [w]))[0].edited_at.getTime(), before.getTime(), '« reçu » ne compte pas comme une modification');
  assert.ok(await fails('other', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.mum, w]));

  await rows('aunt', 'update claims set offered_at = now() where id = $1', [c]);
  assert.ok(!!(await rows('aunt', 'select offered_at from claims where id = $1', [c]))[0].offered_at, '« offert » est enregistré');
  await rows('mum', 'update claims set offered_at = null where id = $1', [c]);
  assert.ok(!!(await rows('aunt', 'select offered_at from claims where id = $1', [c]))[0].offered_at, 'personne d’autre ne le change');

  const r1 = (await rows('mum', 'select new_season() as r'))[0].r;
  assert.equal(r1.wishes, 1);
  assert.equal((await admin('select removed from wishes where id = $1', [w]))[0].removed, true, 'l’envie reçue quitte la liste');
  assert.equal((await admin('select removed from wishes where id = $1', [kept]))[0].removed, false, 'les autres restent');
  const r2 = (await rows('aunt', 'select new_season() as r'))[0].r;
  assert.equal(r2.claims, 1);
  assert.equal((await admin('select * from claims where id = $1', [c])).length, 0, 'le cadeau offert quitte « Ce que j’offre »');
});
