// The consolidated schema (supabase/migrations) must produce exactly the same
// database as the six step-by-step files applied during development
// (supabase/archive) — tables, constraints, indexes, policies, functions,
// triggers and privileges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const STUB = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
`;

async function build(dir, only) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of readdirSync(new URL(`../supabase/${dir}/`, import.meta.url)).filter(f => f.endsWith('.sql') && (!only || f === only)).sort()) {
    await db.exec(readFileSync(new URL(`../supabase/${dir}/${f}`, import.meta.url), 'utf8'));
  }
  return db;
}

const QUERIES = {
  columns: `select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') as def
            from information_schema.columns where table_schema = 'public' order by 1, 2`,
  constraints: `select c.conrelid::regclass::text as t, c.conname, pg_get_constraintdef(c.oid) as def
                from pg_constraint c join pg_namespace n on n.oid = c.connamespace
                where n.nspname = 'public' order by 1, 2`,
  indexes: `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`,
  rls: `select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and relkind = 'r' order by 1`,
  policies: `select tablename, policyname, cmd, roles::text, coalesce(qual, '') as qual, coalesce(with_check, '') as chk
             from pg_policies where schemaname = 'public' order by 1, 2`,
  functions: `select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.provolatile,
                     regexp_replace(p.prosrc, '\\s+', ' ', 'g') as src, coalesce(array_to_string(p.proconfig, ','), '') as cfg
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1, 2`,
  triggers: `select tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid
             join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal order by 1`,
  tableGrants: `select table_name, grantee, privilege_type from information_schema.role_table_grants
                where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`,
  functionGrants: `select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'execute') as can
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   cross join (select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')) r
                   where n.nspname = 'public' order by 1, 2`,
};

test('le schéma fusionné est identique aux six fichiers appliqués un par un', async () => {
  // Only the consolidated file: later migrations (0002…) are new changes, not part of the archive.
  const [steps, squashed] = await Promise.all([build('archive'), build('migrations', '0001_schema.sql')]);
  for (const [name, sql] of Object.entries(QUERIES)) {
    const [a, b] = await Promise.all([steps.query(sql), squashed.query(sql)]);
    assert.deepEqual(b.rows, a.rows, `différence dans : ${name}`);
  }
});
