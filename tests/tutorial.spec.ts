import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Tutorial (wiki/design-tutorial.md): cards pop up the first time a mechanic shows up, once per browser; a card pauses a solo
 * battle; the handbook holds all of them; both languages. An automated run keeps the tutorial silent unless the storage says `on`.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td&seed=7';

async function open(page: Page, tutorial: object | null, lang = 'en'): Promise<void> {
  await page.addInitScript(([tut, l]) => {
    localStorage.setItem('malina.lang', l as string);
    if (tut && !localStorage.getItem('malina.tutorial')) localStorage.setItem('malina.tutorial', tut as string);
  }, [tutorial ? JSON.stringify(tutorial) : null, lang]);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => (window as any).__malina.ready);
}

const card = (page: Page) => page.locator('.tut.open .tut-card');

test('tutorial: the opening cards come one by one, pause the battle and show once', async ({ page }) => {
  await open(page, { on: true });
  await expect(card(page)).toHaveAttribute('data-card', 'td.move');
  await expect(card(page).locator('h3')).toHaveText('Move and fight');
  // the battle stands still while the card is up: the wave timer does not run
  const next0 = await page.evaluate(() => (window as any).__malina.td.next);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).__malina.td.next)).toBe(next0);
  expect(await page.evaluate(() => (window as any).__malina.tutorial.pausing)).toBe(true);

  await page.keyboard.press('Enter');
  await expect(card(page)).toHaveAttribute('data-card', 'td.build');
  await page.waitForTimeout(500);
  await card(page).locator('[data-act="ok"]').click();
  await expect(card(page)).toHaveAttribute('data-card', 'td.wave');
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await expect(page.locator('.tut.open')).toHaveCount(0);
  // the battle goes on
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).__malina.td.next)).toBeLessThan(next0);

  // an urgent card comes at once, a calm one keeps the gap
  await page.evaluate(() => { const t = (window as any).__malina.tutorial; t.fire('td.berries'); t.fire('td.hunters'); });
  await expect(card(page)).toHaveAttribute('data-card', 'td.hunters');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await expect(page.locator('.tut.open')).toHaveCount(0);

  // seen cards are remembered: after a reload the opening run does not repeat
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('malina.tutorial') ?? '{}').seen);
  expect(seen).toEqual(expect.arrayContaining(['td.move', 'td.build', 'td.wave', 'td.hunters']));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.waitForTimeout(800);
  await expect(page.locator('.tut.open')).toHaveCount(0);

  // "show again" brings them back
  await page.evaluate(() => { const t = (window as any).__malina.tutorial; t.reset(); t.fire('td.move'); });
  await expect(card(page)).toHaveAttribute('data-card', 'td.move');
});

test('tutorial: silent in an automated run and when switched off; the handbook holds every card', async ({ page }) => {
  await open(page, null);
  await page.waitForTimeout(600);
  await expect(page.locator('.tut.open')).toHaveCount(0);
  expect(await page.evaluate(() => { const t = (window as any).__malina.tutorial; t.fire('td.move'); return t.card; })).toBeNull();

  await page.evaluate(() => (window as any).__malina.tutorial.openBook('td.wave'));
  const book = page.locator('.tut-book.open');
  await expect(book.locator('.tut-item')).toHaveCount(27);
  await expect(book.locator('.tut-item.sel')).toHaveText('Waves');
  await expect(book.locator('.tut-page .tut-marks li')).toHaveCount(3);
  await page.keyboard.press('ArrowDown');
  await expect(book.locator('.tut-item.sel')).toHaveText('Raspberries');
  await book.locator('.tut-item', { hasText: 'Dusk' }).click();
  await expect(book.locator('.tut-page h3')).toHaveText('Dusk');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tut-book.open')).toHaveCount(0);
});

test('tutorial: "do not show hints" turns the cards off; Russian texts', async ({ page }) => {
  await open(page, { on: true }, 'ru');
  await expect(card(page).locator('h3')).toHaveText('Ходьба и бой');
  await expect(card(page).locator('.tut-marks li').first()).toHaveText('Твой герой');
  await card(page).locator('[data-act="off"]').click();
  await expect(page.locator('.tut.open')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('malina.tutorial') ?? '{}').off)).toBe(true);
  expect(await page.evaluate(() => { const t = (window as any).__malina.tutorial; t.fire('td.build'); return t.card; })).toBeNull();
});
