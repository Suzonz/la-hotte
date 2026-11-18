import { LoginForm } from '@/components/LoginForm';
import { NotConfigured } from '@/components/NotConfigured';
import { isConfigured } from '@/lib/supabase/env';
import { safeNext } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erreur?: string }> }) {
  if (!isConfigured) return <NotConfigured />;
  const { next, erreur } = await searchParams;
  return <LoginForm next={safeNext(next)} linkError={erreur === 'lien'} />;
}
