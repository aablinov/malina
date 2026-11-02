import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Главное меню (wiki/design-main-menu.md): стартовый экран → лагерь (снаряжение, выбор карты) → бой `?map=…&from=menu`
 * → пауза → «В лагерь». Сетевая игра без сервера: старт закрыт (с сервером — tests/net.spec.ts).
 */

const URL = pathToFileURL(resolve('dist/index.html')).href;

async function openMenu(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start');
}

test('меню: одиночная игра — надеть топор в лагере, выбрать поляну, бой, пауза и обратно в лагерь с малиной', async ({ page }) => {
  const errors: string[] = [];
  await openMenu(page, errors);
  await expect(page.locator('.mm-nav .mm-btn.big')).toHaveText([/Одиночная игра/, /Сетевая игра/, /Настройки/]);

  // в сумке новый топор и своя малина
  const uid = await page.evaluate(() => {
    const p = (window as any).__menu.profile;
    p.data.berries = 777;
    const it = p.add('axe', 5);
    return it.uid as string;
  });

  await page.getByRole('button', { name: 'Одиночная игра' }).click();
  await page.waitForFunction(() => (window as any).__menu.screen === 'lobby');
  await expect(page.locator('.mm-lobby.open')).toBeVisible();
  await expect(page.locator('.mm-slot')).toHaveCount(7);

  // двойной клик по гнезду ближнего боя — инвентарь на этой вкладке, двойной клик по топору — надеть
  await page.locator('.mm-slot[data-slot="melee"]').dblclick();
  await expect(page.locator('.inv.open')).toBeVisible();
  await page.locator(`.inv.open .inv-grid .it[data-uid="${uid}"]`).dblclick();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inv.open')).toHaveCount(0);
  await expect(page.locator('.mm-slot[data-slot="melee"] .it-pw')).toHaveText('5');

  // карта — кристальная поляна, в бой
  await page.locator('.mm-tabs [data-pane="map"]').click();
  await expect(page.locator('.mm-map')).toHaveCount(3);
  await page.locator('.mm-map[data-map="td2"]').click();
  await expect(page.locator('.mm-card.map h3')).toHaveText('Кристальная поляна');
  await page.getByRole('button', { name: /Начать игру/ }).click();

  await page.waitForURL(/map=td2&from=menu/);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const battle = await page.evaluate((u) => {
    const m = (window as any).__malina, prof = JSON.parse(localStorage.getItem('malina.profile') ?? '{}');
    const melee = prof.items?.find((i: any) => i.uid === prof.equip?.melee);
    return { waves: m.td.waves.length, berries: m.berries, melee: melee?.def, power: melee?.power, axe: prof.items?.some((i: any) => i.uid === u), title: document.title };
  }, uid);
  // в бою обороны — набор нового героя (src/items.ts, tdKit); топор ждёт в лагере
  expect(battle).toEqual({ waves: 12, berries: 350, melee: 'sword', power: 1, axe: false, title: 'Малина — Кристальная поляна' });

  // Esc — пауза, время стоит; «Выйти в лагерь» — обратно, малина героя на месте
  await page.keyboard.press('Escape');
  await expect(page.locator('.pz.open')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти в лагерь' }).click();
  await page.waitForURL(/menu=lobby/);
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  expect(await page.evaluate(() => (window as any).__menu.profile.data.berries)).toBe(777);
  expect(await page.evaluate(() => (window as any).__menu.profile.data.equip.melee)).toBe(uid);
  expect(errors).toEqual([]);
});

test('меню: сетевая игра без сервера — старт закрыт; итог обороны отмечает карту пройденной', async ({ page }) => {
  const errors: string[] = [];
  await openMenu(page, errors);
  await page.getByRole('button', { name: /Сетевая игра/ }).click();
  await page.waitForFunction(() => (window as any).__menu.screen === 'lobby');
  await page.locator('.mm-tabs [data-pane="map"]').click();
  await expect(page.locator('.mm-online')).toBeVisible();
  await expect(page.locator('.mm-online')).toContainText('Сервер недоступен');
  await page.getByRole('button', { name: /Начать игру/ }).click();
  await expect(page.locator('.mm-hint.warn')).toContainText('Сервер сетевой игры недоступен');
  expect(page.url()).not.toContain('map=');

  // бой из меню: оборона отбита — итог и отметка «пройдена» в лагере
  await page.goto(`${URL}?map=td&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => { (window as any).__malina.td.state = 'won'; });
  await expect(page.locator('.pz.open.won')).toBeVisible();
  await page.getByRole('button', { name: 'В лагерь' }).click();
  await page.waitForFunction(() => (window as any).__menu?.screen === 'lobby');
  await page.locator('.mm-tabs [data-pane="map"]').click();
  await expect(page.locator('.mm-map[data-map="td"] .mm-won')).toBeVisible();
  expect(errors).toEqual([]);
});
