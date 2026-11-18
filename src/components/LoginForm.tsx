'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { Logo } from './Header';

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(linkError ? 'Ce lien de connexion a expiré ou a déjà servi. Demande-en un nouveau.' : null);
  const invited = next.startsWith('/rejoindre/');

  const send = async () => {
    setError(null);
    setState('sending');
    const { error } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setState('idle');
      setError(/rate limit/i.test(error.message)
        ? 'Trop de demandes d’affilée. Attends une minute avant de redemander un lien.'
        : 'L’envoi a échoué. Vérifie l’adresse e-mail et réessaie.');
    } else setState('sent');
  };

  return (
    <div className="wrap centered">
      <div className="panel">
        <div className="brand"><Logo />La Hotte</div>
        {state === 'sent' ? (
          <>
            <h1>Regarde tes e-mails</h1>
            <p className="sub">Un lien de connexion vient d’être envoyé à <b>{email.trim()}</b>. Clique dessus pour entrer.</p>
            <p className="note">Rien reçu après une minute ? Regarde dans les indésirables, ou <button className="linkish" onClick={() => setState('idle')}>essaie une autre adresse</button>.</p>
          </>
        ) : (
          <form className="stack" style={{ alignItems: 'stretch' }} onSubmit={e => { e.preventDefault(); send(); }}>
            <h1>{invited ? 'On t’invite dans un groupe' : 'Connexion'}</h1>
            <p className="sub">{invited
              ? 'Entre ton adresse e-mail : tu recevras un lien pour te connecter, puis tu rejoindras le groupe.'
              : 'Entre ton adresse e-mail : tu recevras un lien pour te connecter. Pas de mot de passe à retenir.'}</p>
            <label htmlFor="email">Adresse e-mail
              <input id="email" type="email" required autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            {error && <div className="error-banner">{error}</div>}
            <button className="btn" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Envoi…' : 'Recevoir mon lien de connexion'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
