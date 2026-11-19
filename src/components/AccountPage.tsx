'use client';

import { useEffect, useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { getSupabase } from '@/lib/supabase/client';

const CONFIRM_WORD = 'SUPPRIMER';

/** « Mon compte » : who I am signed in as, and deleting my account. */
export function AccountPage() {
  const { d, data, actions, run } = useHotte();
  const [email, setEmail] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => { getSupabase().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')); }, []);

  const myGroupsCreated = data.groups.filter(g => g.created_by === d.me);
  const kids = d.myKids;

  const remove = () => run(() => actions.deleteMyAccount()).then(r => {
    if (r.ok) window.location.href = '/login?compte=supprime';
  });

  // The e-mail preference is read here only (nobody else needs it).
  const [digest, setDigest] = useState<boolean | null>(null);
  useEffect(() => {
    if (!d.myPerson) return;
    getSupabase().from('persons').select('email_digest').eq('id', d.myPerson.id).single()
      .then(({ data }) => setDigest(data ? !!(data as { email_digest: boolean }).email_digest : true));
  }, [d.myPerson]);
  const toggleDigest = (on: boolean) => {
    setDigest(on);
    run(async () => {
      const { error } = await getSupabase().from('persons').update({ email_digest: on }).eq('id', d.myPerson!.id);
      if (error) throw error;
    }, on ? 'Tu recevras le récapitulatif par e-mail' : 'Plus d’e-mails récapitulatifs');
  };

  return (
    <>
      <div>
        <span className="eyebrow">Mon compte</span>
        <h1>{d.myPerson?.name}</h1>
        {email && <p className="sub">Connecté avec {email}</p>}
      </div>

      <section className="panel">
        <h2>E-mails</h2>
        <label className="santa-tick" htmlFor="digest">
          <input id="digest" type="checkbox" checked={digest ?? true} disabled={digest === null} onChange={e => toggleDigest(e.target.checked)} />
          Recevoir un récapitulatif par e-mail, au plus un par jour
        </label>
        <p className="note">Par exemple : un cadeau que tu as choisi a été retiré ou modifié, on t’a ajouté à un groupe, le tirage d’un Secret Santa est fait, ou l’échange approche. Jamais rien qui dévoile une surprise.</p>
      </section>

      <section className="panel">
        <h2>Supprimer mon compte</h2>
        <p>Tout ce qui est à toi est effacé définitivement, sans retour possible :</p>
        <ul className="plain-list">
          <li>ton profil et tes envies ;</li>
          {kids.length > 0 && <li>les listes de {kids.map(k => k.name).join(', ')} ;</li>}
          <li>les cadeaux que tu as réservés ou auxquels tu participes : ils redeviennent libres pour les autres ;</li>
          <li>ta place dans les Secret Santa : la personne qui t’offrait un cadeau en reçoit une autre.</li>
        </ul>
        {myGroupsCreated.length > 0 && (
          <p className="note">Les groupes que tu as créés ({myGroupsCreated.map(g => g.name).join(', ')}) ne disparaissent pas : ils sont confiés au membre arrivé le plus tôt après toi. Un groupe où tu es seul est supprimé.</p>
        )}
        <form className="stack" style={{ alignItems: 'stretch' }} onSubmit={e => { e.preventDefault(); if (typed === CONFIRM_WORD) remove(); }}>
          <label htmlFor="confirm-delete">Pour confirmer, écris {CONFIRM_WORD}
            <input id="confirm-delete" value={typed} autoComplete="off" onChange={e => setTyped(e.target.value.toUpperCase())} style={{ maxWidth: 240 }} />
          </label>
          <div><button className="btn danger" type="submit" disabled={typed !== CONFIRM_WORD}>Supprimer définitivement mon compte</button></div>
        </form>
      </section>
    </>
  );
}
