import { redirect } from 'next/navigation';
import { JoinGroup } from '@/components/JoinGroup';
import { NotConfigured } from '@/components/NotConfigured';
import { isConfigured } from '@/lib/supabase/env';
import { createServerSupabase } from '@/lib/supabase/server';

type Invite = { group_id: string; group_name: string; creator_name: string | null; already_member: boolean };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  if (!isConfigured) return <NotConfigured />;
  const { code } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/rejoindre/' + code)}`);

  const [{ data: invites }, { data: me }] = await Promise.all([
    supabase.rpc('invite_info', { code }),
    supabase.from('persons').select('id, name').eq('user_id', user.id).maybeSingle(),
  ]);
  const invite = (invites as Invite[] | null)?.[0] ?? null;
  if (invite?.already_member) redirect(`/?groupe=${invite.group_id}`);

  return <JoinGroup code={code} invite={invite} myName={me?.name ?? null} />;
}
