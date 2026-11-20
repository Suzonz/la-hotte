'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { Logo } from './Header';

// Supabase sends back different limits; say which one it is.
function loginErrorMessage(message: string, code?: string): string {
  const wait = /after (\d+) seconds?/i.exec(message);
  if (wait) return `Un lien vient déjà d’être envoyé à cette adresse. Attends ${wait[1]} secondes avant d’en redemander un.`;
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(message))
    return 'Le nombre d’e-mails de connexion par heure est atteint pour tout le site. Réessaie un peu plus tard, ou utilise le dernier lien reçu s’il n’a pas encore servi.';
  if (code === 'over_request_rate_limit' || /rate limit/i.test(message))
    return 'Trop de demandes depuis cet appareil. Réessaie dans quelques minutes.';
  if (/invalid.*email|email.*invalid/i.test(message)) return 'Cette adresse e-mail n’est pas valide.';
  return 'L’envoi a échoué. Vérifie l’adresse e-mail et réessaie.';
}

export function LoginForm({ next, linkError, deleted }: { next: string; linkError: boolean; deleted?: boolean }) {
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
      setError(loginErrorMessage(error.message, (error as { code?: string }).code));
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
          <form className="stack stretch" onSubmit={e => { e.preventDefault(); send(); }}>
            <h1>{invited ? 'On t’invite dans un groupe' : 'Connexion'}</h1>
            <p className="sub">{invited
              ? 'Entre ton adresse e-mail : tu recevras un lien pour te connecter, puis tu rejoindras le groupe.'
              : 'Entre ton adresse e-mail : tu recevras un lien pour te connecter. Pas de mot de passe à retenir.'}</p>
            <label htmlFor="email">Adresse e-mail
              <input id="email" type="email" required autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            {deleted && <p className="note">Ton compte et tes données ont été supprimés. À bientôt peut-être !</p>}
            {error && <div className="error-banner">{error}</div>}
            <button className="btn" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Envoi…' : 'Recevoir mon lien de connexion'}</button>
          </form>
        )}
        <p className="note text-center"><a href="/confidentialite">Confidentialité</a></p>
      </div>
    </div>
  );
}
