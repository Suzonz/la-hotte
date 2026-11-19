// Talks to the LOCAL Supabase started with `npx supabase start` (never the real project).
import { execSync } from 'node:child_process';

type Status = { API_URL: string; ANON_KEY?: string; PUBLISHABLE_KEY?: string; SERVICE_ROLE_KEY?: string; SECRET_KEY?: string };

let cached: { url: string; anon: string; service: string } | null = null;

export function localSupabase() {
  if (cached) return cached;
  const raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const s = JSON.parse(raw.slice(raw.indexOf('{'))) as Status;
  if (!/127\.0\.0\.1|localhost/.test(s.API_URL)) throw new Error('Les tests ne tournent que sur un Supabase local.');
  cached = { url: s.API_URL, anon: (s.ANON_KEY ?? s.PUBLISHABLE_KEY)!, service: (s.SERVICE_ROLE_KEY ?? s.SECRET_KEY)! };
  return cached;
}

async function admin(path: string, body: unknown) {
  const { url, service } = localSupabase();
  const res = await fetch(`${url}/auth/v1/admin/${path}`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** A fresh test account; returns the URL that signs it in (the same path a magic-link e-mail uses). */
export async function signInUrl(label: string, next = '/') {
  const email = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@test.la-hotte.local`;
  await admin('users', { email, email_confirm: true });
  const link = await admin('generate_link', { type: 'magiclink', email });
  const hash = link.hashed_token ?? link.properties?.hashed_token;
  return `/auth/callback?token_hash=${hash}&type=magiclink&next=${encodeURIComponent(next)}`;
}
