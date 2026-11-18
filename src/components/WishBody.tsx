import { eur, hostOf, WANT_LABEL, wantStars } from '@/lib/format';
import type { Wish } from '@/lib/types';

export function WishBody({ wish, extra }: { wish: Wish; extra?: React.ReactNode }) {
  return (
    <>
      <div className="ihead">
        <h3 className="ititle">{wish.title}</h3>
        {wish.price != null && <span className="price">{eur(wish.price)}</span>}
      </div>
      <div className="meta">
        <span className="want" title={WANT_LABEL[wish.stars]}>{wantStars(wish.stars)} <span>{WANT_LABEL[wish.stars]}</span></span>
        {wish.link && <a href={wish.link} target="_blank" rel="noopener noreferrer">{hostOf(wish.link) || 'Voir le lien'}</a>}
        {extra}
      </div>
      {wish.note && <p className="inote">{wish.note}</p>}
    </>
  );
}
