export const eur = (n: number | null | undefined) =>
  n == null || isNaN(n) ? '' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

/** "12,5 €" → 12.5 ; empty or invalid → null */
export const parseAmount = (s: string): number | null => {
  const n = parseFloat(String(s ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
  return isNaN(n) || n <= 0 ? null : Math.round(n * 100) / 100;
};

export const safeUrl = (u: string): string | null => {
  try {
    const x = new URL(u.trim());
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch {
    return null;
  }
};

export const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
};

export const WANT_LABEL: Record<number, string> = { 1: 'Ce serait sympa', 2: "J'aimerais bien", 3: 'Je rêve de ça' };
export const wantStars = (s: number) => '★'.repeat(s) + '☆'.repeat(3 - s);

export const plural = (n: number, word: string, words?: string) => `${n} ${n > 1 ? (words ?? word + 's') : word}`;

export const byName = (a: string, b: string) => a.localeCompare(b, 'fr');

export function daysToChristmas(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let xmas = new Date(now.getFullYear(), 11, 25);
  if (today > xmas) xmas = new Date(now.getFullYear() + 1, 11, 25);
  return Math.round((xmas.getTime() - today.getTime()) / 86400000);
}
