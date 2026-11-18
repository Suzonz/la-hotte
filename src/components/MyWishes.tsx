'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import type { Person } from '@/lib/types';
import { GroupsPanel } from './GroupsPanel';
import { KidsPanel } from './KidsPanel';
import { ManageWishes } from './ManageWishes';

export function MyWishes({ me, openGroup, onOpenPerson }: { me: Person; openGroup: string | null; onOpenPerson: (id: string) => void }) {
  const { actions, run } = useHotte();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(me.name);

  return (
    <>
      <div>
        <span className="eyebrow">Mes envies</span>
        {renaming ? (
          <form className="row" onSubmit={e => { e.preventDefault(); run(() => actions.renamePerson(me.id, name), 'Prénom modifié').then(r => r.ok && setRenaming(false)); }}>
            <input aria-label="Ton prénom" value={name} maxLength={40} style={{ maxWidth: 240 }} autoFocus onChange={e => setName(e.target.value)} />
            <button className="btn sm" type="submit">Enregistrer</button>
            <button className="btn ghost sm" type="button" onClick={() => setRenaming(false)}>Annuler</button>
          </form>
        ) : (
          <div className="row">
            <h1>Les envies de {me.name}</h1>
            <button className="linkish" onClick={() => { setName(me.name); setRenaming(true); }}>Changer mon prénom</button>
          </div>
        )}
        <p className="note"><b>Tu ne vois jamais ce que les autres te préparent.</b> Chaque groupe ne voit que les envies que tu y as rangées.</p>
      </div>
      <GroupsPanel openGroup={openGroup} />
      <ManageWishes person={me} />
      <p className="note">Si tu retires une envie que quelqu’un avait déjà prise, cette personne est prévenue sur sa page. Toi, tu ne le sauras pas.</p>
      <KidsPanel onOpen={onOpenPerson} />
    </>
  );
}
