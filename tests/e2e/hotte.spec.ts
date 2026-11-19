import { expect, test, type Browser, type Page } from '@playwright/test';
import { signInUrl } from './local-supabase';

// Screenshots of the main screens, to review the design without logging in by hand.
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

/** A new person, signed in, in their own browser context (like a separate phone). */
async function newPerson(browser: Browser, label: string, next = '/') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(await signInUrl(label, next));
  return page;
}

/** First visit: first name, and optionally a first group. */
async function onboard(page: Page, name: string, group?: string) {
  await expect(page.getByRole('heading', { name: 'Bienvenue dans la hotte' })).toBeVisible();
  await page.getByLabel('Ton prénom, tel que les autres te connaissent').fill(name);
  if (group) await page.getByLabel('Ton premier groupe (facultatif)').fill(group);
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page.getByRole('heading', { name: `Les envies de ${name}` })).toBeVisible();
}

/** Adds an envie on « Ma liste », visible by the given groups (or « Seulement moi »). */
async function addWish(page: Page, title: string, who: string[] | 'private', price?: string) {
  const opener = page.getByRole('button', { name: /^＋ Ajouter une envie/ });
  if (await opener.isVisible()) await opener.click();
  const form = page.locator('section', { has: page.getByRole('heading', { name: /^Ajouter une envie/ }) });
  await form.getByLabel('Le cadeau').fill(title);
  if (price) await form.getByLabel('Prix environ (€)').fill(price);
  if (who === 'private') await form.getByLabel('Seulement moi pour l’instant').check();
  else for (const g of who) await form.getByLabel(g, { exact: true }).check();
  await form.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.locator('.items .item', { hasText: title })).toBeVisible();
  await expect(opener).toBeVisible();   // the form folds back once the envie is saved
}

/** Opens a menu tab (« Ma liste », « Mes groupes ») and picks an entry. */
async function menu(page: Page, tab: RegExp, item: string) {
  await page.getByRole('button', { name: tab }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** The invite link of a group, read from its settings. */
async function inviteLink(page: Page, group: string) {
  await menu(page, /Mes groupes/, group);
  await page.getByRole('button', { name: 'Inviter · Réglages' }).click();
  const link = await page.getByLabel('Lien d’invitation du groupe').inputValue();
  return new URL(link).pathname;
}

/** Joins a group through its invite link (creating the profile on the way). */
async function join(browser: Browser, label: string, name: string, path: string) {
  const page = await newPerson(browser, label, path);
  await expect(page.getByRole('heading', { name: /^Rejoindre/ })).toBeVisible();
  await page.getByLabel('Ton prénom, tel que les autres te connaissent').fill(name);
  await page.getByRole('button', { name: 'Rejoindre le groupe' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return page;
}

test('ma liste : envie privée, envie de groupe, filtre', async ({ browser }) => {
  const page = await newPerson(browser, 'liste');
  await onboard(page, 'Alice', 'Famille');
  await addWish(page, 'Carnet secret', 'private');
  await addWish(page, 'Livre de cuisine', ['Famille'], '25');

  const secret = page.locator('.items .item', { hasText: 'Carnet secret' });
  await expect(secret.getByText('🔒 Privée')).toBeVisible();
  await page.getByRole('button', { name: /^Famille \(/ }).click();
  await expect(page.locator('.items .item', { hasText: 'Livre de cuisine' })).toBeVisible();
  await expect(secret).toHaveCount(0);
  await page.getByRole('button', { name: /^Toutes/ }).click();
  await shot(page, '1-ma-liste');
});

test('invitation, réservation, et le secret : on ne voit jamais ce qu’on nous offre', async ({ browser }) => {
  const alice = await newPerson(browser, 'alice');
  await onboard(alice, 'Alice', 'Famille');
  await addWish(alice, 'Écharpe rouge', ['Famille'], '30');
  const path = await inviteLink(alice, 'Famille');

  const bob = await join(browser, 'bob', 'Bob', path);
  await expect(bob.getByRole('heading', { name: 'Famille' })).toBeVisible();
  await bob.getByRole('button', { name: /Alice/ }).click();
  const scarf = bob.locator('.item', { hasText: 'Écharpe rouge' });
  await scarf.getByRole('button', { name: 'Je l’offre' }).click();
  await expect(scarf.getByText('Tu l’offres')).toBeVisible();
  await shot(bob, '2-liste-d-alice-vue-par-bob');

  await bob.getByRole('button', { name: /Ce que j’offre/ }).click();
  await expect(bob.locator('.gline', { hasText: 'Écharpe rouge' })).toBeVisible();
  await shot(bob, '3-ce-que-j-offre');

  // Alice: her envie is still there, with no trace of Bob's reservation anywhere.
  await alice.reload();
  await menu(alice, /Ma liste/, 'Ma liste');
  await expect(alice.locator('.items .item', { hasText: 'Écharpe rouge' })).toBeVisible();
  await expect(alice.getByText(/Déjà pris|Tu l’offres|Bob/)).toHaveCount(0);
  await alice.getByRole('button', { name: /Ce que j’offre/ }).click();
  await expect(alice.locator('main').getByText('Écharpe rouge')).toHaveCount(0);
});

test('Secret Santa : tirage au sort, chacun ne voit que sa personne, suivi du cadeau', async ({ browser }) => {
  const alice = await newPerson(browser, 'santa-a');
  await onboard(alice, 'Alice', 'Famille');
  const path = await inviteLink(alice, 'Famille');
  const bob = await join(browser, 'santa-b', 'Bob', path);
  const chloe = await join(browser, 'santa-c', 'Chloé', path);
  for (const [page, name] of [[bob, 'Bob'], [chloe, 'Chloé']] as const) {
    await menu(page, /Ma liste/, 'Ma liste');
    await addWish(page, `Cadeau pour ${name}`, ['Famille']);
  }

  // Alice creates it and draws in one click.
  await alice.reload();
  await menu(alice, /Mes groupes/, 'Famille');
  await alice.getByRole('button', { name: /Faire le tirage avec La Hotte/ }).click();
  await alice.getByRole('button', { name: '🎲 Tirer au sort' }).click();
  await expect(alice.getByText(/^Tu offres à/)).toBeVisible();
  await shot(alice, '4-secret-santa-apres-tirage');

  // Each one sees exactly one person, never themselves.
  const drawn: Record<string, string> = {};
  for (const [page, name] of [[alice, 'Alice'], [bob, 'Bob'], [chloe, 'Chloé']] as const) {
    await page.reload();
    await menu(page, /Mes groupes/, 'Famille');
    const line = page.locator('.draw-line');
    await expect(line).toHaveCount(1);
    drawn[name] = (await line.locator('b').innerText()).trim();
    expect(drawn[name]).not.toBe(name);
  }
  expect(new Set(Object.values(drawn)).size).toBe(3);

  // Bob reserves a gift for his person and ticks it 🎅 → « complet » → then cancels it.
  const target = drawn.Bob;
  await bob.locator('.draw-line').getByRole('button', { name: 'Voir ses envies' }).click();
  const gift = bob.locator('.item', { hasText: `Cadeau pour ${target}` });
  if (target !== 'Alice') {
    await gift.getByRole('button', { name: 'Je l’offre' }).click();
    await gift.getByLabel(/Pour mon Secret Santa/).check();
  } else {
    await bob.getByRole('button', { name: 'J’offre autre chose' }).click();
    await bob.getByLabel('Ton idée').fill('Un bon pour un resto');
    await bob.getByLabel(/Pour mon Secret Santa/).check();
    await bob.getByRole('button', { name: 'Enregistrer' }).click();
  }
  await expect(bob.getByRole('dialog')).toBeVisible();
  await bob.getByRole('button', { name: '✅ C’est complet' }).click();
  await bob.getByRole('button', { name: /Ce que j’offre/ }).click();
  const status = bob.getByLabel(/Statut du Secret Santa/);
  await expect(status).toHaveValue('done');
  await expect(bob.getByText('🎅 Secret Santa').last()).toBeVisible();
  await shot(bob, '5-ce-que-j-offre-secret-santa');

  await bob.getByRole('button', { name: 'Annuler' }).first().click();
  await bob.getByRole('button', { name: 'Oui' }).click();
  await expect(status).toHaveValue('progress');   // back to « rien de choisi »
});

test('en direct : une réservation apparaît chez les autres sans recharger', async ({ browser }) => {
  const alice = await newPerson(browser, 'live-a');
  await onboard(alice, 'Alice', 'Famille');
  await addWish(alice, 'Bougie parfumée', ['Famille']);
  const path = await inviteLink(alice, 'Famille');
  const bob = await join(browser, 'live-b', 'Bob', path);
  const chloe = await join(browser, 'live-c', 'Chloé', path);

  // Chloé is looking at Alice's list…
  await chloe.getByRole('button', { name: /Alice/ }).click();
  const candle = chloe.locator('.item', { hasText: 'Bougie parfumée' });
  await expect(candle.getByText('Libre')).toBeVisible();
  // …Bob reserves it on his side…
  await bob.getByRole('button', { name: /Alice/ }).click();
  await bob.locator('.item', { hasText: 'Bougie parfumée' }).getByRole('button', { name: 'Je l’offre' }).click();
  // …and Chloé sees it change, without touching anything.
  await expect(candle.getByText('Déjà pris')).toBeVisible({ timeout: 15_000 });
});

test('supprimer son compte', async ({ browser }) => {
  const page = await newPerson(browser, 'adieu');
  await onboard(page, 'Zoé', 'Amis');
  await page.getByRole('button', { name: 'Mon compte' }).click();
  await expect(page.getByRole('heading', { name: 'Supprimer mon compte' })).toBeVisible();
  const button = page.getByRole('button', { name: 'Supprimer définitivement mon compte' });
  await expect(button).toBeDisabled();
  await page.getByLabel(/Pour confirmer, écris SUPPRIMER/).fill('supprimer');
  await button.click();
  await expect(page).toHaveURL(/\/login\?compte=supprime/);
  await expect(page.getByText('Ton compte et tes données ont été supprimés')).toBeVisible();
});

test('téléphone : captures des écrans principaux', async ({ browser }) => {
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' };
  const ctxA = await browser.newContext(phone);
  const alice = await ctxA.newPage();
  await alice.goto(await signInUrl('tel-a'));
  await onboard(alice, 'Alice', 'Famille');
  await addWish(alice, 'Casque audio sans fil avec réduction de bruit', ['Famille'], '89');
  await addWish(alice, 'Carnet', 'private');
  await shot(alice, 'm1-ma-liste');
  await alice.getByRole('button', { name: /Ma liste/ }).click();
  await shot(alice, 'm2-menu-ouvert');
  await alice.keyboard.press('Escape');
  const path = await inviteLink(alice, 'Famille');
  await shot(alice, 'm3-groupe-reglages');

  const ctxB = await browser.newContext(phone);
  const bob = await ctxB.newPage();
  await bob.goto(await signInUrl('tel-b', path));
  await bob.getByLabel('Ton prénom, tel que les autres te connaissent').fill('Bob');
  await bob.getByRole('button', { name: 'Rejoindre le groupe' }).click();
  await bob.getByRole('button', { name: /Alice/ }).click();
  await bob.locator('.item', { hasText: 'Casque' }).getByRole('button', { name: 'Je participe' }).click();
  await bob.getByPlaceholder('20').fill('30');
  await bob.getByRole('button', { name: 'Valider' }).click();
  await shot(bob, 'm4-liste-d-alice');
  await bob.getByRole('button', { name: /Ce que j’offre/ }).click();
  await shot(bob, 'm5-ce-que-j-offre');
  await bob.getByRole('button', { name: /Mes groupes/ }).click();
  await bob.getByRole('menuitem', { name: 'Famille' }).click();
  await bob.getByRole('button', { name: /Faire le tirage avec La Hotte/ }).click();
  await shot(bob, 'm6-secret-santa-creation');
});
