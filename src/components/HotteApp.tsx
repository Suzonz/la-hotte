'use client';

import { useEffect, useState } from 'react';
import { HotteProvider, useHotte } from '@/lib/hotte';
import { GiftsView } from './GiftsView';
import { Header, type Tab } from './Header';
import { MyWishes } from './MyWishes';
import { Onboarding } from './Onboarding';
import { PersonView } from './PersonView';

export function HotteApp({ userId, openGroup }: { userId: string; openGroup: string | null }) {
  return (
    <HotteProvider me={userId}>
      <Screens openGroup={openGroup} />
    </HotteProvider>
  );
}

function Screens({ openGroup }: { openGroup: string | null }) {
  const { d } = useHotte();
  const [tab, setTab] = useState('mine');

  const go = (key: string) => { setTab(key); window.scrollTo({ top: 0 }); };
  // A person can disappear (removed from a group, child deleted): fall back to my page.
  const person = tab !== 'mine' && tab !== 'gifts' ? d.others.find(p => p.id === tab) : null;
  useEffect(() => { if (tab !== 'mine' && tab !== 'gifts' && !person) setTab('mine'); }, [tab, person]);

  if (!d.myPerson) {
    return (
      <>
        <Header tabs={[]} />
        <main className="wrap"><Onboarding /></main>
      </>
    );
  }

  const n = d.myClaims.length;
  const tabs: Tab[] = [
    { key: 'mine', label: 'Mes envies' },
    { key: 'gifts', label: 'À offrir' + (n ? ` · ${n}` : '') },
    ...d.others.map((p, i) => ({ key: p.id, label: p.name, sep: i === 0 })),
  ];

  return (
    <>
      <Header tabs={tabs} current={tab} onSelect={go} />
      <main className="wrap">
        {tab === 'mine' && <MyWishes me={d.myPerson} openGroup={openGroup} onOpenPerson={go} />}
        {tab === 'gifts' && <GiftsView onOpen={go} />}
        {person && <PersonView key={person.id} person={person} onLeave={() => go('mine')} />}
      </main>
    </>
  );
}
