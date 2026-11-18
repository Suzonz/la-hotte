'use client';

import { useHotte } from '@/lib/hotte';
import { byName, eur, hostOf, plural } from '@/lib/format';
import type { Claim } from '@/lib/types';

/** « À offrir » : my shopping list, only visible to me. */
export function GiftsView({ onOpen }: { onOpen: (personId: string) => void }) {
  const { d, data } = useHotte();
  const list = d.myClaims.filter(c => d.personById.has(c.recipient_id));

  if (!list.length) {
    return (
      <>
        <Head />
        <div className="empty">Tu n’as encore rien choisi. Ouvre les envies de quelqu’un dans la barre du haut.</div>
      </>
    );
  }

  const total = list.reduce((s, c) => s + (c.amount ?? 0), 0);
  const byPerson = new Map<string, Claim[]>();
  list.forEach(c => byPerson.set(c.recipient_id, [...(byPerson.get(c.recipient_id) ?? []), c]));
  const people = [...byPerson.keys()].sort((a, b) => byName(d.personById.get(a)!.name, d.personById.get(b)!.name));

  return (
    <>
      <Head />
      <div className="panel">
        <div className="sum">
          <span className="who">{plural(list.length, 'cadeau', 'cadeaux')} ou participation{list.length > 1 ? 's' : ''}</span>
          <strong>{eur(total) || '0 €'}</strong>
        </div>
        <p className="note">Total estimé avec les prix indiqués. Les cadeaux sans prix ne sont pas comptés.</p>
      </div>
      {people.map(pid => {
        const person = d.personById.get(pid)!;
        return (
          <section key={pid} className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{person.name}</h2>
              <button className="linkish" onClick={() => onOpen(pid)}>Voir ses envies</button>
            </div>
            <div>
              {byPerson.get(pid)!.map(c => {
                const w = c.wish_id ? data.wishes.find(x => x.id === c.wish_id) : undefined;
                const kind = c.kind === 'buy' ? 'J’offre' : c.kind === 'part' ? 'Je participe' : 'Hors liste';
                const warn = w?.removed ? ' · retiré de ses envies' : w && w.edited_at > c.updated_at ? ' · modifié depuis' : '';
                return (
                  <div key={c.id} className="gline">
                    <span className="t">
                      <span className="eyebrow">{kind}</span><br />
                      {w?.title ?? (c.note || 'Une surprise')}
                      {warn && <span className="warn">{warn}</span>}
                      {w?.link && <> <a href={w.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>{hostOf(w.link)}</a></>}
                    </span>
                    <span className="a">{c.amount ? eur(c.amount) : '—'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Head() {
  return (
    <div>
      <span className="eyebrow">Mes cadeaux</span>
      <h1>Ce que j’offre</h1>
      <p className="sub">Ton récapitulatif pour faire les courses. Personne d’autre ne voit ce total.</p>
    </div>
  );
}
