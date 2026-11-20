'use client';

import Link from 'next/link';
import { useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { Logo } from './Header';

type Invite = { group_id: string; group_name: string; creator_name: string | null };

export function JoinGroup({ code, invite, myName }: { code: string; invite: Invite | null; myName: string | null }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setError(null);
    if (!myName && !name.trim()) return setError('Écris ton prénom.');
    setBusy(true);
    const sb = getSupabase();
    if (!myName) {
      const { data: { user } } = await sb.auth.getUser();
      const { error } = await sb.from('persons').insert({ user_id: user?.id, name: name.trim() });
      if (error) { setBusy(false); return setError('Impossible de créer ton profil. Réessaie.'); }
    }
    const { data, error } = await sb.rpc('join_group', { code });
    if (error) { setBusy(false); return setError('Ce lien ne marche plus. Demande un nouveau lien à la personne qui t’a invité(e).'); }
    window.location.href = `/?groupe=${data}`;
  };

  return (
    <div className="wrap centered">
      <div className="panel">
        <div className="brand"><Logo />La Hotte</div>
        {!invite ? (
          <>
            <h1>Lien d’invitation invalide</h1>
            <p className="sub">Le groupe a peut-être été supprimé, ou son lien a été changé. Demande un nouveau lien à la personne qui t’a invité(e).</p>
            <Link className="btn link-as-btn" href="/">Aller à mes envies</Link>
          </>
        ) : (
          <form className="stack stretch" onSubmit={e => { e.preventDefault(); join(); }}>
            <span className="eyebrow">Invitation</span>
            <h1>Rejoindre « {invite.group_name} »</h1>
            <p className="sub">
              {invite.creator_name ? `Groupe créé par ${invite.creator_name}. ` : ''}
              Tu verras les envies que ses membres destinent à ce groupe, et tu pourras y ranger les tiennes. Personne ne verra ce qu’on te prépare.
            </p>
            {!myName && (
              <label htmlFor="name">Ton prénom, tel que les autres te connaissent
                <input id="name" value={name} maxLength={40} autoFocus autoComplete="given-name" placeholder="Ex. Mamie Jo" onChange={e => setName(e.target.value)} />
              </label>
            )}
            {error && <div className="error-banner">{error}</div>}
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Un instant…' : 'Rejoindre le groupe'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
