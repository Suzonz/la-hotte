'use client';

import { useEffect, useState } from 'react';
import { HotteProvider, useHotte } from '@/lib/hotte';
import { AccountPage } from './AccountPage';
import { AddKidPage, NewGroupPage } from './CreatePages';
import { GiftsView } from './GiftsView';
import { GroupView } from './GroupView';
import { Header, type Tab } from './Header';
import { ListPage } from './ListPage';
import { Onboarding } from './Onboarding';
import { PersonView } from './PersonView';

export function HotteApp({ userId, openGroup }: { userId: string; openGroup: string | null }) {
  return (
    <HotteProvider me={userId}>
      <Screens openGroup={openGroup} />
    </HotteProvider>
  );
}

// The three tabs: Ma liste ▾ (me, my children, add a child) · Mes groupes ▾ (each group, new group) · Ce que j'offre
type View =
  | { kind: 'list'; personId?: string }          // no personId = my own list
  | { kind: 'addKid' }
  | { kind: 'group'; groupId: string; settings?: boolean }
  | { kind: 'newGroup' }
  | { kind: 'person'; personId: string; groupId?: string }
  | { kind: 'gifts' }
  | { kind: 'account' };

function Screens({ openGroup }: { openGroup: string | null }) {
  const { d, data } = useHotte();
  // Arriving from an invite link opens the group just joined.
  const [view, setView] = useState<View>(() => (openGroup ? { kind: 'group', groupId: openGroup } : { kind: 'list' }));
  const go = (v: View) => { setView(v); window.scrollTo({ top: 0 }); };

  // Open someone: my own children go to their list (where I manage them).
  const openPerson = (personId: string, groupId?: string) => {
    const p = data.persons.find(x => x.id === personId);
    if (p?.user_id === d.me) go({ kind: 'list' });
    else if (p && d.isKid(p) && d.manages(p) && !groupId) go({ kind: 'list', personId });
    else go({ kind: 'person', personId, groupId });
  };

  // Things can disappear (left a group, child deleted…): fall back to my list.
  const groupId = view.kind === 'group' || view.kind === 'person' ? view.groupId : undefined;
  const group = groupId ? d.myGroups.find(g => g.id === groupId) ?? null : null;
  const listPerson = view.kind === 'list' ? (view.personId ? d.myKids.find(k => k.id === view.personId) : d.myPerson) : null;
  const person = view.kind === 'person' ? data.persons.find(p => p.id === view.personId && p.user_id !== d.me) ?? null : null;
  const lost = (view.kind === 'list' && !listPerson && !!d.myPerson)
    || (view.kind === 'group' && !group)
    || (view.kind === 'person' && (!person || (!!groupId && !group)));
  useEffect(() => { if (lost) setView({ kind: 'list' }); }, [lost]);

  if (!d.myPerson) {
    return (
      <>
        <Header tabs={[]} />
        <main className="wrap"><Onboarding /></main>
      </>
    );
  }

  const listId = view.kind === 'list' ? view.personId : undefined;
  const n = d.myClaims.filter(c => !c.offered_at).length;   // still to give
  const tabs: Tab[] = [
    {
      key: 'list', label: 'Ma liste', active: view.kind === 'list' || view.kind === 'addKid',
      menu: [
        { key: 'me', label: 'Ma liste', current: view.kind === 'list' && !listId, onSelect: () => go({ kind: 'list' }) },
        ...d.myKids.map(k => ({ key: k.id, label: `Liste de ${k.name}`, current: listId === k.id, onSelect: () => go({ kind: 'list', personId: k.id }) })),
        { key: 'addKid', label: '＋ Ajouter un enfant', accent: true, onSelect: () => go({ kind: 'addKid' }) },
      ],
    },
    {
      // On a phone the group's name stays in the page title, so the tabs fit on one line.
      key: 'groups', label: group ? <>Mes groupes<span className="hide-sm"> · {group.name}</span></> : 'Mes groupes',
      active: view.kind === 'group' || view.kind === 'newGroup' || (view.kind === 'person' && !!groupId),
      menu: [
        ...d.myGroups.map(g => ({ key: g.id, label: g.name, current: groupId === g.id, onSelect: () => go({ kind: 'group', groupId: g.id }) })),
        { key: 'new', label: '＋ Nouveau groupe', accent: true, onSelect: () => go({ kind: 'newGroup' }) },
      ],
    },
    { key: 'gifts', label: 'Ce que j’offre' + (n ? ` · ${n}` : ''), active: view.kind === 'gifts', onSelect: () => go({ kind: 'gifts' }) },
  ];

  return (
    <>
      <Header tabs={tabs} />
      <main className="wrap">
        {view.kind === 'list' && listPerson && <ListPage key={listPerson.id} person={listPerson} onDeleted={() => go({ kind: 'list' })} />}
        {view.kind === 'addKid' && <AddKidPage onCreated={id => go({ kind: 'list', personId: id })} onCancel={() => go({ kind: 'list' })} />}
        {view.kind === 'newGroup' && <NewGroupPage onCreated={id => go({ kind: 'group', groupId: id, settings: true })} onCancel={() => go({ kind: 'list' })} />}
        {view.kind === 'gifts' && <GiftsView onOpen={openPerson} />}
        {view.kind === 'group' && group && (
          <GroupView key={group.id} group={group} initialSettings={view.settings}
            onOpenMine={() => go({ kind: 'list' })}
            onOpenPerson={id => openPerson(id, group.id)} />
        )}
        {view.kind === 'person' && person && (
          <>
            {group && <button className="linkish backlink" onClick={() => go({ kind: 'group', groupId: group.id })}>← {group.name}</button>}
            <PersonView key={person.id + (group?.id ?? '')} person={person} group={group ?? undefined} />
          </>
        )}
        {view.kind === 'account' && <AccountPage />}
      </main>
      <footer className="app-footer">
        <button onClick={() => go({ kind: 'account' })}>Mon compte</button>
        <a href="/confidentialite">Confidentialité</a>
      </footer>
    </>
  );
}
