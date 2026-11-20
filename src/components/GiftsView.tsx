'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { byName, eur, hostOf } from '@/lib/format';
import type { Claim } from '@/lib/types';
import { StopClaim } from './StopClaim';
import { SantaTracker } from './santa/SantaGifts';

type Sort = 'person' | 'group';

/** One thing I give: what, for whom, 🎅 if it is for my Secret Santa, and a way to cancel it. */
function ClaimLine({ claim: c, showWho }: { claim: Claim; showWho: boolean }) {
  const { d, data, actions, run } = useHotte();
  const w = c.wish_id ? data.wishes.find(x => x.id === c.wish_id) : undefined;
  const kind = c.kind === 'buy' ? 'J’offre' : c.kind === 'part' ? 'Je participe' : 'Hors liste';
  const received = !!w?.received_at;   // good news, not a warning
  const warn = received ? '' : w?.removed ? ' · retiré de ses envies' : w && w.edited_at > c.updated_at ? ' · modifié depuis' : '';
  const who = d.personById.get(c.recipient_id)!;
  const forSanta = data.santaGifts.some(x => x.claim_id === c.id);
  const title = w?.title ?? (c.note || 'Une surprise');
  // The box follows the click at once; the saved value takes over after the reload.
  const [offeredNow, setOfferedNow] = useState<boolean | null>(null);
  const offered = offeredNow ?? !!c.offered_at;

  return (
    <div className={'gline' + (offered ? ' offered' : '')}>
      <div className="gmain">
        <span className="t">
          <span className="eyebrow">{kind}{showWho ? ` · pour ${who.name}` : ''}</span>
          {forSanta && <span className="chip pot" style={{ marginLeft: 6 }}>🎅 Secret Santa</span>}
          <br />
          <span className="gtitle">{title}</span>
          {received && <span className="who"> · reçu</span>}
          {warn && <span className="warn">{warn}</span>}
          {w?.link && <> <a href={w.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>{hostOf(w.link)}</a></>}
        </span>
        <span className="row" style={{ justifyContent: 'flex-end' }}>
          {c.amount ? <span className="a">{eur(c.amount)}</span> : null}
          {!c.offered_at && <StopClaim claim={c} title={title} />}
        </span>
      </div>
      <label className="tick">
        <input type="checkbox" checked={offered} aria-label={`Offert : ${title}`} onChange={e => {
          const v = e.target.checked;
          setOfferedNow(v);
          run(() => actions.setOffered(c.id, v), v ? `« ${title} » est offert ✓` : undefined).then(() => setOfferedNow(null));
        }} />
        Offert
      </label>
    </div>
  );
}

/** « Ce que j'offre » : everything I give, in one place, only visible to me. */
export function GiftsView({ onOpen }: { onOpen: (personId: string, groupId?: string) => void }) {
  const { d, data } = useHotte();
  const [sort, setSort] = useState<Sort>('person');
  const all = d.myClaims.filter(c => d.personById.has(c.recipient_id));
  // Given gifts go to « Ce que j'ai offert », at the bottom.
  const list = all.filter(c => !c.offered_at);
  const given = all.filter(c => c.offered_at);

  // A claim belongs to the groups (of mine) where its envie is filed — or, for an
  // off-list gift, to the groups I share with the recipient.
  const groupsOfClaim = (c: Claim) => {
    const person = d.personById.get(c.recipient_id)!;
    const shared = d.commonGroups(person).map(g => g.id);
    return c.wish_id ? d.groupsOfWish(c.wish_id).filter(g => shared.includes(g)) : shared;
  };

  const line = (c: Claim, showWho: boolean) => <ClaimLine key={c.id} claim={c} showWho={showWho} />;

  const sections: { key: string; title: string; claims: Claim[]; open: () => void; showWho: boolean }[] = [];
  if (sort === 'person') {
    const byPerson = new Map<string, Claim[]>();
    list.forEach(c => byPerson.set(c.recipient_id, [...(byPerson.get(c.recipient_id) ?? []), c]));
    [...byPerson.keys()].sort((a, b) => byName(d.personById.get(a)!.name, d.personById.get(b)!.name)).forEach(pid => {
      sections.push({ key: pid, title: d.personById.get(pid)!.name, claims: byPerson.get(pid)!, open: () => onOpen(pid), showWho: false });
    });
  } else {
    d.myGroups.forEach(g => {
      const claims = list.filter(c => groupsOfClaim(c).includes(g.id));
      if (claims.length) sections.push({ key: g.id, title: g.name, claims, open: () => {}, showWho: true });
    });
    const orphans = list.filter(c => groupsOfClaim(c).length === 0);
    if (orphans.length) sections.push({ key: 'none', title: 'Hors de tes groupes actuels', claims: orphans, open: () => {}, showWho: true });
  }

  return (
    <>
      <div>
        <span className="eyebrow">Ce que j’offre</span>
        <h1>Mes cadeaux à offrir</h1>
        <p className="sub">Tout ce que tu as choisi, au même endroit. Personne d’autre ne voit cette page.</p>
      </div>

      <SantaTracker onOpenPerson={(pid, gid) => onOpen(pid, gid)} />

      {!list.length ? (
        <div className="empty">{given.length
          ? 'Plus rien à offrir pour l’instant.'
          : 'Tu n’as encore rien choisi. Ouvre un groupe dans « Mes groupes », puis la liste d’une personne, pour réserver un cadeau ou participer.'}</div>
      ) : (
        <>
          <div className="filters" role="group" aria-label="Trier">
            <button aria-pressed={sort === 'person'} onClick={() => setSort('person')}>Par personne</button>
            <button aria-pressed={sort === 'group'} onClick={() => setSort('group')}>Par groupe</button>
          </div>
          {sort === 'group' && <p className="note">Un cadeau rangé dans deux groupes apparaît dans les deux.</p>}

          {sections.map(sec => {
            const sub = sec.claims.reduce((s, c) => s + (c.amount ?? 0), 0);
            return (
              <section key={sec.key} className="panel">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2>{sec.title}</h2>
                  <span className="row">
                    {sub > 0 && <span className="who">{eur(sub)}</span>}
                    {sort === 'person' && <button className="linkish" onClick={sec.open}>Voir ses envies</button>}
                  </span>
                </div>
                <div>{sec.claims.map(c => line(c, sec.showWho))}</div>
              </section>
            );
          })}
        </>
      )}

      {given.length > 0 && (
        <section className="panel">
          <h2>Ce que j’ai offert ({given.length})</h2>
          <div>{given.map(c => line(c, true))}</div>
          <p className="note">Les cadeaux offerts sont supprimés au bout d’un mois.</p>
        </section>
      )}
    </>
  );
}
