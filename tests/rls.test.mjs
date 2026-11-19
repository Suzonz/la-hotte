// Checks the privacy rules of supabase/migrations against a real Postgres (PGlite),
// with a minimal stand-in for Supabase's auth schema.
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

// Run queries as a signed-in user (RLS applies), like the Supabase API does.
async function as(user, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U[user]}', false); set role authenticated;`);
  try { return await fn((sql, params) => db.query(sql, params)); }
  finally { await db.exec('reset role'); }
}
const rows = async (user, sql, params) => (await as(user, q => q(sql, params))).rows;
const fails = async (user, sql, params) => {
  try { await as(user, q => q(sql, params)); } catch { return true; }
  return false;
};

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
    -- Only what Supabase itself provides; table and function rights come from the migration.
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ${Object.values(U).map(u => `('${u}')`).join(',')};
  `);

  for (const [name, uid] of Object.entries(U)) {
    ids[name] = (await rows(name, 'insert into persons (user_id, name) values ($1, $2) returning id', [uid, name]))[0].id;
  }
  ids.fam = (await rows('alice', "insert into groups (name) values ('Famille') returning id"))[0].id;
  ids.col = (await rows('chloe', "insert into groups (name) values ('Collègues') returning id"))[0].id;
  const famCode = (await rows('alice', 'select invite_code from groups where id = $1', [ids.fam]))[0].invite_code;
  const colCode = (await rows('chloe', 'select invite_code from groups where id = $1', [ids.col]))[0].invite_code;
  ids.famCode = famCode;
  await rows('bob', 'select join_group($1)', [famCode]);
  await rows('alice', 'select join_group($1)', [colCode]);

  ids.kid = (await rows('alice', "insert into persons (manager_id, name) values ($1, 'Léo') returning id", [U.alice]))[0].id;
  const wish = async (person, title, groups) => {
    const id = (await rows('alice', 'insert into wishes (person_id, title) values ($1, $2) returning id', [person, title]))[0].id;
    for (const g of groups) await rows('alice', 'insert into wish_groups values ($1, $2)', [id, g]);
    return id;
  };
  ids.livre = await wish(ids.alice, 'Livre', [ids.fam]);
  ids.pull = await wish(ids.alice, 'Pull', [ids.col]);
  ids.both = await wish(ids.alice, 'Casque', [ids.fam, ids.col]);
  ids.kidWish = await wish(ids.kid, 'Lego', [ids.fam]);

  await rows('bob', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.alice, ids.livre]);
  await rows('chloe', "insert into claims (recipient_id, wish_id, kind, amount) values ($1, $2, 'part', 20)", [ids.alice, ids.both]);
  await rows('bob', "insert into claims (recipient_id, wish_id, kind, amount) values ($1, $2, 'part', 10)", [ids.alice, ids.both]);
  await rows('bob', "insert into claims (recipient_id, kind, note) values ($1, 'other', 'Écharpe')", [ids.alice]);
  await rows('bob', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.kid, ids.kidWish]);
});

const titles = async user => (await rows(user, 'select title from wishes order by title')).map(r => r.title);

test('Alice ne voit aucune réservation faite pour elle', async () => {
  assert.equal((await rows('alice', 'select * from claims where recipient_id = $1', [ids.alice])).length, 0);
});

test('un parent voit les réservations faites pour son enfant', async () => {
  assert.equal((await rows('alice', 'select * from claims where recipient_id = $1', [ids.kid])).length, 1);
});

test('chaque groupe ne voit que ses envies', async () => {
  assert.deepEqual(await titles('bob'), ['Casque', 'Lego', 'Livre']);      // Famille
  assert.deepEqual(await titles('chloe'), ['Casque', 'Pull']);             // Collègues
  assert.deepEqual(await titles('dan'), []);                               // aucun groupe
  assert.deepEqual(await titles('alice'), ['Casque', 'Lego', 'Livre', 'Pull']);
});

test("on ne voit que les personnes avec qui on partage un groupe", async () => {
  const names = async u => (await rows(u, 'select name from persons order by name')).map(r => r.name);
  assert.deepEqual(await names('bob'), ['Léo', 'alice', 'bob']);
  // Chloé partage « Collègues » avec Alice : elle sait que Léo existe, mais ne voit aucune de ses envies (rangées dans Famille).
  assert.deepEqual(await names('chloe'), ['Léo', 'alice', 'chloe']);
  assert.equal((await rows('chloe', 'select * from wishes where person_id = $1', [ids.kid])).length, 0);
  assert.deepEqual(await names('dan'), ['dan']);
});

test("une réservation d'un autre groupe est visible, mais pas son auteur", async () => {
  const onBoth = await rows('bob', 'select claimer_id from claims where wish_id = $1', [ids.both]);
  assert.equal(onBoth.length, 2);
  assert.equal((await rows('bob', 'select * from persons where user_id = $1', [U.chloe])).length, 0);
});

test("on n'apprend pas l'existence des groupes dont on n'est pas membre", async () => {
  assert.equal((await rows('bob', 'select * from wish_groups where wish_id = $1', [ids.both])).length, 1);
  assert.equal((await rows('bob', 'select * from groups')).length, 1);
});

test('réservations interdites : envie invisible, sa propre envie, deuxième « je l’offre »', async () => {
  assert.ok(await fails('chloe', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.alice, ids.livre]));
  assert.ok(await fails('alice', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.alice, ids.pull]));
  assert.ok(await fails('chloe', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.alice, ids.pull]) === false);
  // Bob a déjà pris le Lego de Léo : Alice (sa mère, qui voit la réservation) ne peut pas le prendre en plus.
  assert.ok(await fails('alice', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.kid, ids.kidWish]));
  // Une participation ne peut pas être transformée en « je l'offre » par un update.
  await rows('chloe', "update claims set kind = 'buy' where wish_id = $1", [ids.both]);
  assert.equal((await rows('chloe', 'select kind from claims where wish_id = $1 and claimer_id = $2', [ids.both, U.chloe]))[0].kind, 'part');
});

test("on ne peut ni modifier ni supprimer la réservation d'un autre", async () => {
  await rows('chloe', 'update claims set amount = 999 where claimer_id = $1', [U.bob]);
  await rows('alice', 'delete from claims where claimer_id = $1', [U.bob]);
  const bobs = await rows('bob', 'select amount from claims where claimer_id = $1 and kind = $2', [U.bob, 'part']);
  assert.equal(bobs.length, 1);
  assert.equal(Number(bobs[0].amount), 10);
});

test("ajouter quelqu'un : seulement une personne avec qui on partage déjà un groupe", async () => {
  assert.ok(await fails('alice', 'insert into group_members (group_id, user_id, added_by) values ($1, $2, $3)', [ids.fam, U.dan, U.alice]));
  const colCode = (await rows('chloe', 'select invite_code from groups where id = $1', [ids.col]))[0].invite_code;
  await rows('dan', 'select join_group($1)', [colCode]);
  assert.ok(!(await fails('alice', 'insert into group_members (group_id, user_id, added_by) values ($1, $2, $3)', [ids.fam, U.dan, U.alice])));
  assert.ok((await titles('dan')).includes('Livre'));
});

test('retirer un membre : créateur oui, simple membre non, et on peut quitter', async () => {
  await rows('dan', 'delete from group_members where group_id = $1 and user_id = $2', [ids.fam, U.bob]);
  assert.ok((await titles('bob')).includes('Livre'), 'Dan ne peut pas retirer Bob');
  await rows('bob', 'delete from group_members where group_id = $1 and user_id = $2', [ids.fam, U.alice]);
  assert.ok((await titles('bob')).includes('Livre'), 'personne ne retire le créateur');
  await rows('alice', 'delete from group_members where group_id = $1 and user_id = $2', [ids.fam, U.bob]);
  assert.deepEqual(await titles('bob'), [], 'Bob retiré ne voit plus rien');
  await rows('dan', 'delete from group_members where group_id = $1 and user_id = $2', [ids.fam, U.dan]);
  assert.ok(!(await titles('dan')).includes('Livre'), 'Dan a quitté Famille');
});

test("changer le lien d'invitation : seul le créateur, et l'ancien lien ne marche plus", async () => {
  assert.ok(await fails('chloe', 'select regenerate_invite($1)', [ids.fam]));
  await rows('alice', "update groups set invite_code = 'pirate' where id = $1", [ids.fam]);
  assert.notEqual((await rows('alice', 'select invite_code from groups where id = $1', [ids.fam]))[0].invite_code, 'pirate');
  const fresh = (await rows('alice', 'select regenerate_invite($1) as c', [ids.fam]))[0].c;
  assert.notEqual(fresh, ids.famCode);
  assert.ok(await fails('bob', 'select join_group($1)', [ids.famCode]));
  await rows('bob', 'select join_group($1)', [fresh]);
  assert.ok((await titles('bob')).includes('Livre'));
});

test("modifier une envie la date ; on ne peut pas s'approprier la liste d'un autre", async () => {
  const before = (await rows('alice', 'select edited_at from wishes where id = $1', [ids.livre]))[0].edited_at;
  await new Promise(r => setTimeout(r, 20));
  await rows('alice', "update wishes set note = 'poche' where id = $1", [ids.livre]);
  const after = (await rows('alice', 'select edited_at from wishes where id = $1', [ids.livre]))[0].edited_at;
  assert.ok(after > before);
  await rows('bob', "update wishes set title = 'piraté' where id = $1", [ids.livre]);
  assert.equal((await rows('alice', 'select title from wishes where id = $1', [ids.livre]))[0].title, 'Livre');
  assert.ok(await fails('bob', "insert into wishes (person_id, title) values ($1, 'x')", [ids.alice]));
  await rows('bob', 'update persons set user_id = $1 where id = $2', [U.bob, ids.dan]);
  assert.equal((await rows('dan', 'select user_id from persons where id = $1', [ids.dan]))[0].user_id, U.dan);
});

test('une envie retirée ne peut plus être réservée', async () => {
  await rows('alice', 'update wishes set removed = true where id = $1', [ids.pull]);
  assert.ok(await fails('dan', "insert into claims (recipient_id, wish_id, kind, amount) values ($1, $2, 'part', 5)", [ids.alice, ids.pull]));
});

test('une envie privée (sans groupe) n’est visible que par son propriétaire', async () => {
  const id = (await rows('alice', "insert into wishes (person_id, title) values ($1, 'Secret') returning id", [ids.alice]))[0].id;
  assert.equal((await rows('alice', 'select * from wishes where id = $1', [id])).length, 1);
  for (const u of ['bob', 'chloe', 'dan']) assert.equal((await rows(u, 'select * from wishes where id = $1', [id])).length, 0, u);
  assert.ok(await fails('bob', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy')", [ids.alice, id]));
});
