'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';

/** First visit without an invite link: first name, and optionally a first group. */
export function Onboarding() {
  const { actions, run, toast } = useHotte();
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');

  const submit = () => {
    if (!name.trim()) return toast('Écris ton prénom.');
    const g = group.trim();
    run(() => actions.createProfile(name, g || null),
      g ? `Groupe « ${g} » créé : invite des personnes avec son lien` : 'Ton espace est prêt : tes envies restent privées tant que tu ne les partages pas');
  };

  return (
    <>
      <div>
        <h1>Bienvenue dans la hotte</h1>
        <p className="sub">Écris tes envies, regarde celles des autres et choisis ce que tu offres, sans jamais savoir ce qu’on te prépare.</p>
      </div>
      <form className="panel" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label>Ton prénom, tel que les autres te connaissent
          <input value={name} maxLength={40} placeholder="Ex. Mamie Jo" autoComplete="given-name" autoFocus onChange={e => setName(e.target.value)} />
        </label>
        <label>Ton premier groupe (facultatif)
          <input value={group} maxLength={50} placeholder="Ex. Famille" onChange={e => setGroup(e.target.value)} />
        </label>
        <p className="note">Un groupe, ce sont les personnes qui verront les envies que tu y ranges : la famille, les amis, les collègues… Tu peux aussi commencer seul : tes envies restent privées jusqu’à ce que tu crées ou rejoignes un groupe. Si on t’a envoyé un lien de groupe, ouvre plutôt ce lien.</p>
        <div className="row"><button className="btn" type="submit">Créer mon espace</button></div>
      </form>
    </>
  );
}
