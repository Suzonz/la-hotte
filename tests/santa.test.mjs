// Secret Santa rules (supabase/migrations/0002_secret_santa.sql) on a real Postgres (PGlite).
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
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U[user]}', false); set role authenticated;`);
  try { return await fn((sql, params) => db.query(sql, params)); }
  finally { await db.exec('reset role'); }
}
const rows = async (user, sql, params) => (await as(user, q => q(sql, params))).rows;
const fails = async (user, sql, params) => {
  try { await as(user, q => q(sql, params)); } catch { return true; }
  return false;
};
const future = "now() + interval '30 days'";

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
  const code = (await rows('alice', 'select invite_code from groups where id = $1', [ids.fam]))[0].invite_code;
  await rows('bob', 'select join_group($1)', [code]);
  await rows('chloe', 'select join_group($1)', [code]);
  ids.leo = (await rows('alice', "insert into persons (manager_id, name) values ($1, 'Léo') returning id", [U.alice]))[0].id;

  ids.santa = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, 'Noël', 'draw', current_date, ${future}) returning id`, [ids.fam]))[0].id;
  for (const p of ['alice', 'bob', 'chloe', 'leo']) {
    await rows('alice', 'insert into santa_participants values ($1, $2)', [ids.santa, ids[p]]);
  }
  await rows('alice', 'insert into santa_exclusions values ($1, $2, $3)', [ids.santa, ids.alice, ids.bob]);
});

const pairs = (user, s = ids.santa) => rows(user, 'select giver_id, receiver_id, entered_by, changed_at from santa_pairs where santa_id = $1', [s]);

test("on ne voit pas un Secret Santa d'un groupe dont on n'est pas membre, ni n'y ajoute un inconnu", async () => {
  assert.equal((await rows('dan', 'select * from santas')).length, 0);
  assert.ok(await fails('alice', 'insert into santa_participants values ($1, $2)', [ids.santa, ids.dan]));
  assert.ok(await fails('bob', 'insert into santa_participants values ($1, $2)', [ids.santa, ids.bob]));
});

test('seul l’organisateur peut lancer ou effacer le tirage', async () => {
  assert.ok(await fails('bob', 'select santa_draw($1)', [ids.santa]));
  assert.ok(await fails('bob', 'select santa_reset($1)', [ids.santa]));
});

test('« tirage à faire » : personne ne saisit de nom à la main, le serveur tire tout', async () => {
  assert.ok(await fails('bob', 'insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values ($1, $2, $3, $4)', [ids.santa, ids.bob, ids.chloe, U.bob]), 'Bob ne choisit pas sa personne');
  assert.ok(await fails('alice', 'insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values ($1, $2, $3, $4)', [ids.santa, ids.bob, ids.chloe, U.alice]), "l'organisatrice non plus");
  const n = (await rows('alice', 'select santa_draw($1) as n', [ids.santa]))[0].n;
  assert.equal(n, 4);
  assert.deepEqual((await rows('chloe', 'select * from santa_progress($1)', [ids.santa]))[0], { participants: 4, drawn: 4 });
  await rows('alice', "update santas set mode = 'manual' where id = $1", [ids.santa]).catch(() => {});
  assert.equal((await rows('alice', 'select mode from santas where id = $1', [ids.santa]))[0].mode, 'draw', 'on ne change pas de type une fois tiré');
});

test('avant la révélation, chacun ne voit que son tirage (et celui de ses enfants)', async () => {
  const a = await pairs('alice');
  assert.deepEqual(a.map(p => p.giver_id).sort(), [ids.alice, ids.leo].sort(), 'Alice : le sien et celui de Léo, pas ceux de Bob et Chloé');
  assert.deepEqual((await pairs('bob')).map(p => p.giver_id), [ids.bob]);
  assert.deepEqual((await pairs('chloe')).map(p => p.giver_id), [ids.chloe]);
  assert.equal((await pairs('dan')).length, 0);
  // Alice can only learn who drew her if it is her own child Léo (she manages his draw).
  const drewAlice = await rows('alice', 'select giver_id from santa_pairs where receiver_id = $1', [ids.alice]);
  assert.ok(drewAlice.every(p => p.giver_id === ids.leo), 'Alice ne sait pas qui l’a tirée (sauf si c’est Léo)');
  assert.equal((await rows('bob', 'select * from santa_pairs where receiver_id = $1', [ids.bob])).length, 0, 'Bob ne sait pas qui l’a tiré');
});

test('le tirage respecte les exclusions ; révélation à la date prévue', async () => {
  await rows('alice', `update santas set reveal_at = now() - interval '1 minute' where id = $1`, [ids.santa]);
  const all = await pairs('chloe');
  assert.equal(all.length, 4, 'après la révélation, tous les membres voient tout');
  assert.ok(!all.some(p => (p.giver_id === ids.alice && p.receiver_id === ids.bob) || (p.giver_id === ids.bob && p.receiver_id === ids.alice)));
  assert.ok(all.every(p => p.entered_by === null), 'toutes les paires viennent du tirage au sort');
  assert.equal(new Set(all.map(p => p.receiver_id)).size, 4, 'chacun reçoit une seule fois');
  assert.ok(all.every(p => p.giver_id !== p.receiver_id));
  assert.equal((await pairs('dan')).length, 0, 'Dan, hors du groupe, ne voit rien même après');
});

test("on ne peut pas effacer un tirage fait par l'appli pour en choisir un autre", async () => {
  await rows('chloe', 'delete from santa_pairs where giver_id = $1', [ids.chloe]);
  assert.ok((await pairs('chloe')).some(p => p.giver_id === ids.chloe));
});

const manualSanta = async name => {
  const s = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, $2, 'manual', current_date, ${future}) returning id`, [ids.fam, name]))[0].id;
  for (const p of ['alice', 'bob', 'chloe']) await rows('alice', 'insert into santa_participants values ($1, $2)', [s, ids[p]]);
  return s;
};
const enter = (user, s, g, r) => rows(user, 'insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values ($1, $2, $3, $4)', [s, ids[g], ids[r], U[user]]);

test('« tirage déjà fait » : chacun saisit son nom, sans voir ceux des autres', async () => {
  const s = await manualSanta('Papier chacun');
  await enter('bob', s, 'bob', 'chloe');
  assert.ok(await fails('chloe', 'insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values ($1, $2, $3, $4)', [s, ids.alice, ids.chloe, U.chloe]), 'Chloé ne saisit pas pour Alice');
  assert.ok(await fails('chloe', 'insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values ($1, $2, $3, $4)', [s, ids.chloe, ids.chloe, U.chloe]), 'personne ne se tire soi-même');
  await enter('chloe', s, 'chloe', 'alice');
  assert.deepEqual((await pairs('chloe', s)).map(p => p.giver_id), [ids.chloe]);
  assert.equal((await pairs('alice', s)).length, 0, "l'organisatrice ne voit pas les saisies des autres");
  assert.ok(await fails('alice', 'select santa_draw($1)', [s]), 'pas de tirage au sort sur un tirage déjà fait');
  await rows('chloe', 'delete from santa_pairs where santa_id = $1 and giver_id = $2', [s, ids.bob]);
  assert.equal((await rows('chloe', 'select * from santa_progress($1)', [s]))[0].drawn, 2, 'Chloé ne peut pas effacer la saisie de Bob');
});

test("« tirage déjà fait » : l'organisateur ne saisit pas pour les autres, mais voit qui manque", async () => {
  const s = await manualSanta('Papier organisateur');
  assert.ok(await fails('alice', 'insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values ($1, $2, $3, $4)', [s, ids.bob, ids.chloe, U.alice]));
  await enter('bob', s, 'bob', 'chloe');
  const missing = async u => (await rows(u, 'select santa_missing($1) as p', [s])).map(r => r.p).sort();
  assert.deepEqual(await missing('alice'), [ids.alice, ids.chloe].sort(), "l'organisatrice voit qui n'a pas encore indiqué sa personne");
  assert.deepEqual(await missing('bob'), [], 'les autres membres, non');
  await rows('alice', 'select santa_reset($1)', [s]);
  assert.equal((await rows('alice', 'select * from santa_progress($1)', [s]))[0].drawn, 0);
});

// A complete, valid draw: everyone gives once, receives once, never to themself.
const checkChain = (all, people) => {
  assert.equal(all.length, people.length);
  assert.deepEqual(all.map(p => p.giver_id).sort(), [...people].sort());
  assert.deepEqual(all.map(p => p.receiver_id).sort(), [...people].sort());
  assert.ok(all.every(p => p.giver_id !== p.receiver_id));
};
const revealNow = s => rows('alice', `update santas set reveal_at = now() - interval '1 minute' where id = $1`, [s]);
const drawSanta4 = async name => {
  const s = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, $2, 'draw', current_date, ${future}) returning id`, [ids.fam, name]))[0].id;
  for (const p of ['alice', 'bob', 'chloe', 'leo']) await rows('alice', 'insert into santa_participants values ($1, $2)', [s, ids[p]]);
  await rows('alice', 'select santa_draw($1)', [s]);
  return s;
};

test('après le tirage, la liste ne se modifie plus directement (ni ajout, ni retrait)', async () => {
  const s = await drawSanta4('Figé');
  await rows('alice', 'delete from santa_participants where santa_id = $1 and person_id = $2', [s, ids.bob]);
  assert.ok(await rows('alice', 'select * from santa_participants where santa_id = $1 and person_id = $2', [s, ids.bob]).then(r => r.length === 1));
  assert.ok(await fails('alice', 'insert into santa_participants values ($1, $2)', [s, ids.dan]));
});

test('retirer quelqu’un après le tirage raccroche la chaîne, une seule personne change (au plus deux)', async () => {
  for (let round = 0; round < 8; round++) {
    const s = await drawSanta4('Retrait ' + round);
    await revealNow(s);
    const before = await pairs('chloe', s);
    const changed = (await rows('alice', 'select santa_remove_participant($1, $2) as n', [s, ids.bob]))[0].n;
    const after = await pairs('chloe', s);
    checkChain(after, [ids.alice, ids.chloe, ids.leo]);
    const moved = after.filter(p => before.find(b => b.giver_id === p.giver_id)?.receiver_id !== p.receiver_id);
    assert.equal(moved.length, changed, 'le nombre annoncé est le bon');
    assert.ok(changed >= 1 && changed <= 2);
    assert.ok(moved.every(p => p.changed_at), 'celui dont le tirage a changé est marqué pour être prévenu');
    assert.ok(after.filter(p => !moved.includes(p)).every(p => !p.changed_at), 'les autres ne sont pas marqués');
  }
});

test('retrait refusé : pas l’organisateur, moins de 3 restants, saisies incomplètes', async () => {
  const s = await drawSanta4('Refus');
  assert.ok(await fails('bob', 'select santa_remove_participant($1, $2)', [s, ids.chloe]));
  await rows('alice', 'select santa_remove_participant($1, $2)', [s, ids.leo]);
  assert.ok(await fails('alice', 'select santa_remove_participant($1, $2)', [s, ids.chloe]), 'pas en dessous de 3');

  const m = await manualSanta('Incomplet');
  await enter('bob', m, 'bob', 'chloe');
  assert.ok(await fails('alice', 'select santa_remove_participant($1, $2)', [m, ids.chloe]), "tant que tout le monde n'a pas indiqué sa personne");
});

test('retrait en « tirage déjà fait » : la personne concernée garde la main sur sa saisie', async () => {
  const m = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, 'Papier 4', 'manual', current_date, ${future}) returning id`, [ids.fam]))[0].id;
  for (const p of ['alice', 'bob', 'chloe', 'leo']) await rows('alice', 'insert into santa_participants values ($1, $2)', [m, ids[p]]);
  await enter('alice', m, 'alice', 'bob'); await enter('bob', m, 'bob', 'chloe'); await enter('chloe', m, 'chloe', 'leo'); await enter('alice', m, 'leo', 'alice');
  assert.equal((await rows('alice', 'select santa_remove_participant($1, $2) as n', [m, ids.bob]))[0].n, 1);
  const alices = await pairs('alice', m);
  const mine = alices.find(p => p.giver_id === ids.alice);
  assert.equal(mine.receiver_id, ids.chloe, 'Alice offrait à Bob, qui offrait à Chloé : Alice offre maintenant à Chloé');
  assert.equal(mine.entered_by, U.alice, 'Alice peut encore corriger cette saisie');
});

test('tirage impossible : message clair, rien n’est enregistré', async () => {
  const s = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, 'Impossible', 'draw', current_date, ${future}) returning id`, [ids.fam]))[0].id;
  for (const p of ['alice', 'bob', 'chloe']) await rows('alice', 'insert into santa_participants values ($1, $2)', [s, ids[p]]);
  for (const [a, b] of [['alice', 'bob'], ['bob', 'chloe'], ['alice', 'chloe']]) await rows('alice', 'insert into santa_exclusions values ($1, $2, $3)', [s, ids[a], ids[b]]);
  assert.ok(await fails('alice', 'select santa_draw($1)', [s]));
  assert.equal((await rows('alice', 'select * from santa_progress($1)', [s]))[0].drawn, 0);
});

test('il faut au moins 3 participants', async () => {
  const s = (await rows('alice', `insert into santas (group_id, name, mode, event_date, reveal_at) values ($1, 'Duo', 'draw', current_date, ${future}) returning id`, [ids.fam]))[0].id;
  for (const p of ['alice', 'bob']) await rows('alice', 'insert into santa_participants values ($1, $2)', [s, ids[p]]);
  assert.ok(await fails('alice', 'select santa_draw($1)', [s]));
});

test("l'organisateur peut supprimer un Secret Santa, même déjà tiré ; les autres non", async () => {
  const s = await manualSanta('Doublon');
  await rows('alice', 'insert into santa_exclusions values ($1, $2, $3)', [s, ids.bob, ids.chloe]);
  await enter('alice', s, 'alice', 'bob');
  await rows('bob', 'delete from santas where id = $1', [s]);
  assert.equal((await rows('alice', 'select * from santas where id = $1', [s])).length, 1, 'Bob ne peut pas le supprimer');
  const deleted = await rows('alice', 'delete from santas where id = $1 returning id', [s]);
  assert.equal(deleted.length, 1, "l'organisateur le supprime");
  assert.equal((await rows('alice', 'select * from santas where id = $1', [s])).length, 0);
});

test('sans type choisi, ni tirage au sort ni saisie ; une fois choisi, ça marche', async () => {
  const s = (await rows('alice', `insert into santas (group_id, name, event_date, reveal_at) values ($1, 'À choisir', current_date, ${future}) returning id`, [ids.fam]))[0].id;
  assert.equal((await rows('alice', 'select mode from santas where id = $1', [s]))[0].mode, null, 'pas de type par défaut');
  for (const p of ['alice', 'bob', 'chloe']) await rows('alice', 'insert into santa_participants values ($1, $2)', [s, ids[p]]);
  assert.ok(await fails('alice', 'select santa_draw($1)', [s]));
  assert.ok(await fails('bob', 'insert into santa_pairs (santa_id, giver_id, receiver_id, entered_by) values ($1, $2, $3, $4)', [s, ids.bob, ids.chloe, U.bob]));
  await rows('alice', "update santas set mode = 'draw' where id = $1", [s]);
  assert.equal((await rows('alice', 'select santa_draw($1) as n', [s]))[0].n, 3);
});

test('cadeaux Secret Santa et statut : visibles seulement par celui qui offre', async () => {
  // Alice → Bob, Bob → Chloé, Chloé → Alice (tirage papier)
  const m = await manualSanta('Suivi cadeaux');
  await enter('alice', m, 'alice', 'bob'); await enter('bob', m, 'bob', 'chloe'); await enter('chloe', m, 'chloe', 'alice');
  const wish = (await rows('bob', "insert into wishes (person_id, title) values ($1, 'Écharpe') returning id", [ids.bob]))[0].id;
  await rows('bob', 'insert into wish_groups values ($1, $2)', [wish, ids.fam]);
  const claim = (await rows('alice', "insert into claims (recipient_id, wish_id, kind) values ($1, $2, 'buy') returning id", [ids.bob, wish]))[0].id;

  await rows('alice', 'insert into santa_gifts (claim_id, santa_id, giver_id) values ($1, $2, $3)', [claim, m, ids.alice]);
  await rows('alice', 'insert into santa_status (santa_id, giver_id, done) values ($1, $2, true)', [m, ids.alice]);
  assert.equal((await rows('alice', 'select * from santa_gifts where santa_id = $1', [m])).length, 1);

  // Chloé voit la réservation d'Alice sur la liste de Bob…
  assert.equal((await rows('chloe', 'select * from claims where id = $1', [claim])).length, 1);
  // …mais pas qu'elle est pour le Secret Santa, ni le statut.
  assert.equal((await rows('chloe', 'select * from santa_gifts')).length, 0);
  assert.equal((await rows('chloe', 'select * from santa_status where giver_id = $1', [ids.alice])).length, 0);
  assert.equal((await rows('bob', 'select * from santa_gifts')).length, 0, 'Bob, qui reçoit, non plus');

  // On ne marque que SES réservations, pour la personne qu'on a tirée.
  assert.ok(await fails('chloe', 'insert into santa_gifts (claim_id, santa_id, giver_id) values ($1, $2, $3)', [claim, m, ids.chloe]));
  const other = await manualSanta('Autre tirage');
  await enter('alice', other, 'alice', 'chloe');
  assert.ok(await fails('alice', 'insert into santa_gifts (claim_id, santa_id, giver_id) values ($1, $2, $3)', [claim, other, ids.alice]), "Alice a tiré Chloé dans celui-là, pas Bob");
  assert.ok(await fails('chloe', 'update santa_status set done = false where giver_id = $1', [ids.alice]).then(() => true));
  assert.equal((await rows('alice', 'select done from santa_status where santa_id = $1', [m]))[0].done, true, 'Chloé ne change pas le statut d’Alice');
});
