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

test('formulaire : ce qui manque est signalé sous le champ, et l’envie modifiée a son encadré', async ({ browser }) => {
  const page = await newPerson(browser, 'formulaire');
  await onboard(page, 'Inès', 'Famille');
  const form = page.locator('section', { has: page.getByRole('heading', { name: /^Ajouter une envie/ }) });
  await form.getByRole('button', { name: 'Ajouter' }).click();
  await expect(form.getByText('Écris le nom du cadeau')).toBeVisible();
  await expect(form.getByText('Choisis qui verra cette envie')).toBeVisible();

  await form.getByLabel('Le cadeau').fill('Aquarium');
  await expect(form.getByText('Écris le nom du cadeau')).toHaveCount(0);   // gone as soon as it is fixed
  await shot(page, '0-formulaire-incomplet');
  await form.getByLabel('Famille', { exact: true }).check();
  await expect(form.getByText('Choisis qui verra cette envie')).toHaveCount(0);
  await form.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.locator('.items .item', { hasText: 'Aquarium' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^＋ Ajouter une envie/ })).toBeVisible();

  await addWish(page, 'Manteau', ['Famille']);
  await page.locator('.items .item', { hasText: 'Aquarium' }).getByRole('button', { name: 'Modifier' }).click();
  await expect(page.locator('.item.editing')).toBeVisible();
  await shot(page, '0-modifier-clair');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);   // let the colour transition end
  await shot(page, '0-modifier-sombre');
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
  await expect(bob.getByText('(ne voit pas ce qui est réservé)')).toBeVisible();
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
    await expect(gift.getByLabel(/Secret Santa/)).not.toBeChecked();   // never ticked for you
    await gift.getByLabel(/Secret Santa/).check();
  } else {
    await bob.getByRole('button', { name: 'J’offre autre chose' }).click();
    await bob.getByLabel('Ton idée').fill('Un bon pour un resto');
    await expect(bob.getByLabel(/Secret Santa/)).not.toBeChecked();
    await bob.getByLabel(/Secret Santa/).check();
    await bob.getByRole('button', { name: 'Enregistrer' }).click();
  }
  await expect(bob.getByRole('dialog')).toBeVisible();
  await bob.getByRole('button', { name: '✅ C’est complet' }).click();
  await bob.getByRole('button', { name: /Ce que j’offre/ }).click();
  const status = bob.getByLabel(/Statut du Secret Santa/);
  await expect(status).toHaveValue('done');
  await expect(bob.getByText('🎅 Secret Santa').last()).toBeVisible();
  await shot(bob, '5-ce-que-j-offre-secret-santa');

  await bob.getByRole('button', { name: 'Je ne l’offre plus' }).first().click();
  await expect(bob.getByRole('dialog')).toContainText('Il est aussi retiré de ton Secret Santa.');
  await shot(bob, '5a-confirmation-arret');
  await bob.getByRole('dialog').getByRole('button', { name: 'Je ne l’offre plus' }).click();
  await expect(status).toHaveValue('progress');   // back to « rien de choisi »

  // An off-list gift: the third person sees it on the page, with the same words as an envie.
  await menu(bob, /Mes groupes/, 'Famille');
  await bob.getByRole('button', { name: new RegExp(target) }).first().click();
  await bob.getByRole('button', { name: 'J’offre autre chose' }).click();
  await bob.getByLabel('Ton idée').fill('Un livre de cuisine');
  await bob.getByRole('button', { name: 'Enregistrer' }).click();
  const third = target === 'Alice' ? chloe : alice;
  await third.reload();
  await menu(third, /Mes groupes/, 'Famille');
  await third.getByRole('button', { name: new RegExp(target) }).first().click();
  const off = third.locator('.item', { hasText: 'Un livre de cuisine' });
  await expect(off.getByText('Déjà pris')).toBeVisible();
  await expect(off.getByText('par Bob · hors liste')).toBeVisible();
  await expect(off.getByRole('button')).toHaveCount(0);   // not mine: nothing to do on it
  await third.emulateMedia({ colorScheme: 'dark' });
  await third.waitForTimeout(400);
  await shot(third, '5b-hors-liste-sombre');
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
  await expect(bob.getByRole('button', { name: 'Je ne participe plus' })).toBeVisible();   // the longest line
  await shot(bob, 'm4-liste-d-alice');
  await bob.emulateMedia({ colorScheme: 'dark' });
  await bob.getByRole('button', { name: 'Je ne participe plus' }).click();
  await expect(bob.getByRole('dialog')).toContainText('Ta part est retirée de la cagnotte.');
  await bob.waitForTimeout(400);
  await shot(bob, 'm4b-confirmation-sombre');
  await bob.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
  await bob.emulateMedia({ colorScheme: 'light' });
  await bob.getByRole('button', { name: /Ce que j’offre/ }).click();
  await shot(bob, 'm5-ce-que-j-offre');
  await bob.getByRole('button', { name: /Mes groupes/ }).click();
  await bob.getByRole('menuitem', { name: 'Famille' }).click();
  await bob.getByRole('button', { name: /Faire le tirage avec La Hotte/ }).click();
  await shot(bob, 'm6-secret-santa-creation');
});

test('deux parents : la liste de l’enfant se partage', async ({ browser }) => {
  const mum = await newPerson(browser, 'maman');
  await onboard(mum, 'Maman', 'Famille');
  await menu(mum, /Ma liste/, '＋ Ajouter un enfant');
  await mum.getByLabel('Prénom de l’enfant').fill('Léo');
  await mum.getByRole('button', { name: 'Créer sa liste' }).click();
  await expect(mum.getByRole('heading', { name: 'Les envies de Léo' })).toBeVisible();
  const path = await inviteLink(mum, 'Famille');

  const dad = await join(browser, 'papa', 'Papa', path);
  await menu(mum, /Ma liste/, 'Liste de Léo');
  await mum.getByRole('button', { name: '+ Partager la gestion' }).click();
  await mum.getByRole('button', { name: 'Papa' }).click();
  await expect(mum.locator('ul.members')).toContainText('Papa');

  await dad.reload();
  await menu(dad, /Ma liste/, 'Liste de Léo');
  await addWish(dad, 'Train en bois', ['Famille']);
  await mum.reload();
  await menu(mum, /Ma liste/, 'Liste de Léo');
  await expect(mum.locator('.items .item', { hasText: 'Train en bois' })).toBeVisible();
  await shot(mum, '6-parents-de-leo');

  // Taking a parent off: a real confirmation, [Annuler] [Retirer].
  await mum.locator('ul.members li', { hasText: 'Papa' }).getByRole('button', { name: 'Retirer' }).click();
  const dialog = mum.getByRole('dialog');
  await expect(dialog).toContainText('Retirer Papa des parents de Léo ?');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(mum.locator('ul.members')).toContainText('Papa');
  await mum.locator('ul.members li', { hasText: 'Papa' }).getByRole('button', { name: 'Retirer' }).click();
  await dialog.getByRole('button', { name: 'Retirer' }).click();
  await expect(mum.locator('ul.members')).not.toContainText('Papa');
});

test('après Noël : reçu, offert, puis supprimés au bout d’un mois', async ({ browser }) => {
  const alice = await newPerson(browser, 'noel-a');
  await onboard(alice, 'Alice', 'Famille');
  await addWish(alice, 'Gants', ['Famille']);
  const path = await inviteLink(alice, 'Famille');
  const bob = await join(browser, 'noel-b', 'Bob', path);
  await bob.getByRole('button', { name: /Alice/ }).click();
  await bob.locator('.item', { hasText: 'Gants' }).getByRole('button', { name: 'Je l’offre' }).click();

  // Alice: ticking « Reçu » moves the envie to « Cadeaux reçus ».
  await menu(alice, /Ma liste/, 'Ma liste');
  await alice.locator('.items .item', { hasText: 'Gants' }).getByLabel('Reçu').check();
  await expect(alice.getByRole('heading', { name: 'Cadeaux reçus (1)' })).toBeVisible();
  // Bob is told, and can no longer reserve it.
  await expect(bob.locator('.item', { hasText: 'Gants' }).getByText('Alice l’a déjà reçu.')).toBeVisible({ timeout: 15_000 });

  await expect(alice.getByText('Les cadeaux reçus sont supprimés au bout d’un mois.')).toBeVisible();
  await shot(alice, '7-cadeaux-recus');

  // Bob: « Offert », and the gift moves down to « Ce que j’ai offert ».
  await bob.getByRole('button', { name: /Ce que j’offre/ }).click();
  await bob.getByLabel('Offert : Gants').check();
  const given = bob.locator('section', { has: bob.getByRole('heading', { name: 'Ce que j’ai offert (1)' }) });
  await expect(given.locator('.gline', { hasText: 'Gants' })).toBeVisible();
  await expect(given.getByText('Les cadeaux offerts sont supprimés au bout d’un mois.')).toBeVisible();
  await expect(bob.getByText('Plus rien à offrir pour l’instant.')).toBeVisible();
  await shot(bob, '7-ce-que-j-ai-offert');
  // (the deletion after a month is the server's job: tests/family.test.mjs)
});

test('mon compte : le récapitulatif par e-mail se coupe et se remet', async ({ browser }) => {
  const page = await newPerson(browser, 'mails');
  await onboard(page, 'Inès');
  await page.getByRole('button', { name: 'Mon compte' }).click();
  const box = page.getByLabel('Recevoir un récapitulatif par e-mail, au plus un par jour');
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.reload();
  await page.getByRole('button', { name: 'Mon compte' }).click();
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();
});

test('envie : crayon, corbeille avec confirmation, case « Reçu »', async ({ browser }) => {
  const page = await newPerson(browser, 'icones');
  await onboard(page, 'Inès', 'Famille');
  await addWish(page, 'Aquarium', ['Famille'], '45');
  await addWish(page, 'Manteau', ['Famille']);
  const aquarium = page.locator('.items .item', { hasText: 'Aquarium' });
  await shot(page, '0-envies-icones');

  await aquarium.getByRole('button', { name: 'Supprimer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer « Aquarium » ?' });
  await shot(page, '0-confirmation-suppression');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(aquarium).toBeVisible();
  await aquarium.getByRole('button', { name: 'Supprimer' }).click();
  await dialog.getByRole('button', { name: 'Supprimer' }).click();
  await expect(aquarium).toHaveCount(0);

  const manteau = page.locator('.items .item', { hasText: 'Manteau' });
  await manteau.getByLabel('Reçu').check();
  const received = page.locator('section.received');
  await expect(received.getByRole('heading', { name: 'Cadeaux reçus (1)' })).toBeVisible();
  await shot(page, '0-cadeaux-recus');
  await received.getByLabel('Reçu').uncheck();
  await expect(page.locator('.items .item', { hasText: 'Manteau' })).toBeVisible();
  await expect(received).toHaveCount(0);
});
