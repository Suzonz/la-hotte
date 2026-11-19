'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { byName, plural } from '@/lib/format';
import type { Group, Person } from '@/lib/types';
import { GroupDetail } from './GroupSettings';
import { SantaSection } from './santa/SantaSection';

/** A group's page: who is in it (and their children), with a way into each person's envies. */
export function GroupView({ group, initialSettings, onOpenPerson, onOpenMine }: {
  group: Group; initialSettings?: boolean; onOpenPerson: (id: string) => void; onOpenMine: () => void;
}) {
  const { d, data } = useHotte();
  // A freshly created group opens on its settings, to copy the invite link.
  const [settings, setSettings] = useState(!!initialSettings);

  const memberIds = d.membersOf(group.id).map(m => m.user_id);
  const liveInGroup = (p: Person) => d.wishesOf(p.id).filter(w => !w.removed && d.groupsOfWish(w.id).includes(group.id));

  const accounts = memberIds
    .map(uid => d.personByUser.get(uid))
    .filter((p): p is Person => !!p)
    .sort((a, b) => (a.user_id === d.me ? -1 : b.user_id === d.me ? 1 : byName(a.name, b.name)));
  // Children appear under the group when their parent is a member and they have envies here (always for my own children).
  const kids = data.persons
    .filter(p => p.manager_id && memberIds.includes(p.manager_id))
    .filter(p => p.manager_id === d.me || liveInGroup(p).length > 0)
    .sort((a, b) => byName(a.name, b.name));

  const card = (p: Person) => {
    const isMe = p.user_id === d.me;
    const n = liveInGroup(p).length;
    const parent = p.manager_id ? d.personByUser.get(p.manager_id) : null;
    return (
      <li key={p.id}>
        <button className="member-card" onClick={() => (isMe ? onOpenMine() : onOpenPerson(p.id))}>
          <span className="avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
          <span className="stack" style={{ gap: 2 }}>
            <b>{isMe ? `${p.name} (toi)` : p.name}</b>
            <span className="who">
              {plural(n, 'envie')} dans ce groupe
              {parent ? ` · enfant de ${parent.user_id === d.me ? 'toi' : parent.name}` : ''}
            </span>
          </span>
          <span className="chev" aria-hidden="true">›</span>
        </button>
      </li>
    );
  };

  return (
    <>
      <div className="listhead">
        <div>
          <span className="eyebrow">Groupe</span>
          <h1>{group.name}</h1>
          <p className="sub">{plural(accounts.length, 'membre')}{kids.length ? ` et ${plural(kids.length, 'enfant')}` : ''}. Clique sur quelqu’un pour voir ses envies dans ce groupe.</p>
        </div>
        <button className="btn alt sm" onClick={() => setSettings(s => !s)} aria-expanded={settings}>
          {settings ? 'Fermer les réglages' : 'Inviter · Réglages'}
        </button>
      </div>

      {settings && <GroupDetail group={group} onClosed={() => setSettings(false)} />}

      <ul className="member-list">{accounts.map(card)}</ul>

      {kids.length > 0 && (
        <>
          <h2>Les enfants</h2>
          <ul className="member-list">{kids.map(card)}</ul>
        </>
      )}

      {accounts.length === 1 && (
        <div className="empty">Tu es seul dans ce groupe pour l’instant. Clique sur « Inviter · Réglages » pour copier son lien d’invitation.</div>
      )}

      <SantaSection group={group} onOpenPerson={id => (d.personById.get(id)?.user_id === d.me ? onOpenMine() : onOpenPerson(id))} />
    </>
  );
}
