import { redirect } from 'next/navigation';
import { HotteApp } from '@/components/HotteApp';
import { NotConfigured } from '@/components/NotConfigured';
import { isConfigured } from '@/lib/supabase/env';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ groupe?: string }> }) {
  if (!isConfigured) return <NotConfigured />;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { groupe } = await searchParams;
  return <HotteApp userId={user.id} openGroup={groupe ?? null} />;
}
