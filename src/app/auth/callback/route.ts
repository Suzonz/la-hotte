import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase, safeNext } from '@/lib/supabase/server';

// Lands here from the magic-link e-mail. Handles both link styles:
//  - ?code=…                    (Supabase's default e-mail; same browser only)
//  - ?token_hash=…&type=email   (recommended template; works on any device)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const supabase = await createServerSupabase();

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;

  const target = ok ? next : `/login?erreur=lien&next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(new URL(target, url.origin));
}
