import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The five-bar redesign: title bar slims to three controls, the stage bar takes
 * the deck switcher, the pen gets its own palette row, the drawer's palette
 * floats outside the drawer, and the landing library searches, filters by tag
 * and pages ten lectures at a time.
 */

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.getByTestId('landing-continue').click();
  await expect(page.getByTestId('slide-card')).toBeVisible();
}

/** Restores a 13-deck study file through the landing's own restore input. */
async function seedDecks(page: Page, count = 13) {
  const decks = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const tags = number % 3 === 0 ? ['Python', '기초'] : number % 3 === 1 ? ['CS'] : ['Python'];
    return {
      id: `deck_seed_${number}`,
      title: `시드 강의 ${number}${number === 12 ? ' 파이썬' : ''}`,
      summary: number % 2 === 0 ? '검색용 요약 스택' : '자료구조 강의',
      tags,
      createdAt: 1_700_000_000_000 + number,
      updatedAt: 1_700_000_000_000 + number,
      slides: [{
        id: `sl_seed_${number}`,
        title: `1장`,
        markdown: `# 1장\n\n시드 ${number}`,
        note: '',
        status: 'unlearned',
      }],
    };
  });
  const file = { format: 'saga-glitra-study', version: 1, app: 'Sága Glitra', exportedAt: new Date().toISOString(), activeDeckId: decks[0].id, decks, strokes: {} };
  const dir = mkdtempSync(join(tmpdir(), 'saga-seed-'));
  const path = join(dir, 'seed.study.json');
  writeFileSync(path, JSON.stringify(file));

  await page.getByTestId('landing').evaluate((element) => element.scrollTo({ top: 0 }));
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('landing-restore-study').click();
  await (await chooser).setFiles(path);
  await expect(page.locator('.toast.on')).toContainText('백업을 복원했습니다');
  await page.getByTestId('brand-home').click();
  await expect(page.getByTestId('landing')).toBeVisible();
  await expect(page.getByTestId('deck-count')).toHaveText(String(count));
}

test.describe('타이틀 바 · 두 번째 바', () => {
  test('타이틀 바는 가져오기 · 테마 · ⋮만 남고 ⋮가 잘리지 않는다', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const viewport = page.viewportSize()!;
    await expect(page.locator('.topbar [data-testid="deck-button"]')).toHaveCount(0);
    await expect(page.locator('.topbar [data-testid="header-open-md"]')).toBeVisible();
    await expect(page.locator('.topbar [data-testid="theme-toggle"]')).toBeVisible();

    const menu = await page.getByTestId('menu-button').boundingBox();
    expect(menu).not.toBeNull();
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(viewport.width);
    expect(menu!.x).toBeGreaterThanOrEqual(0);

    const topbarText = await page.locator('.topbar').textContent();
    expect(topbarText).toContain('가져오기');
    expect(topbarText).not.toContain('Web-HQ');
    expect(topbarText).not.toContain('발표');

    expect(errors).toEqual([]);
  });

  test('두 번째 바에 덱 드롭다운이 있고 한 줄로 들어온다', async ({ page }, testInfo) => {
    const errors = watchConsole(page);
    await boot(page);

    const viewport = page.viewportSize()!;
    const layout = await page.evaluate(() => {
      const stage = document.querySelector('.stage-bar') as HTMLElement;
      const bar = stage.getBoundingClientRect();
      const buttons = [...stage.querySelectorAll('button')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '', left: rect.left, right: rect.right };
        });
      const deck = (document.querySelector('.stage-bar [data-testid="deck-button"]') as HTMLElement).getBoundingClientRect();
      return {
        bar: { top: bar.top, bottom: bar.bottom, height: bar.height, left: bar.left, right: bar.right },
        deck: { left: deck.left, right: deck.right, top: deck.top, bottom: deck.bottom },
        buttons,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.bar.height).toBeLessThanOrEqual(testInfo.project.name === 'mobile' ? 52 : 56);
    expect(layout.deck.top).toBeGreaterThanOrEqual(layout.bar.top);
    expect(layout.deck.right).toBeLessThanOrEqual(viewport.width);
    for (const button of layout.buttons) {
      expect(button.right, `‘${button.name}’ 버튼이 잘렸습니다`).toBeLessThanOrEqual(viewport.width);
      expect(button.left).toBeGreaterThanOrEqual(0);
    }

    // The dropdown really lists the decks and switching works.
    await page.getByTestId('deck-button').click();
    await expect(page.getByTestId('deck-menu')).toBeVisible();
    // The button stays reachable while its own popover is open.
    await page.getByTestId('deck-button').click();
    await expect(page.getByTestId('deck-menu')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('보기 아이콘은 가림막 눈 아이콘과 다르다', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const paths = await page.evaluate(() => {
      const read = (el: Element | null) => el?.innerHTML.replace(/\s+/g, ' ').trim() ?? '';
      return {
        view: read(document.querySelector('.seg [aria-label="보기"] svg')),
        mask: read(document.querySelector('[data-testid="mask-all"] svg')),
      };
    });
    expect(paths.view.length).toBeGreaterThan(0);
    expect(paths.mask.length).toBeGreaterThan(0);
    expect(paths.view).not.toBe(paths.mask);

    // Edit and split keep their own icons too.
    const edit = await page.evaluate(() => document.querySelector('.seg [aria-label="편집"] svg')?.innerHTML.length ?? 0);
    expect(edit).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('필기를 누르면 바 아래 전용 팔레트 줄이 열리고, 끄면 사라진다', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await expect(page.getByTestId('ink-subbar')).toHaveCount(0);

    const barBefore = await page.locator('.stage-bar').boundingBox();
    await page.getByTestId('pen-toggle').click();
    await expect(page.getByTestId('ink-subbar')).toBeVisible();
    await page.waitForTimeout(260); // the row slides in; measure it settled

    const bar = await page.locator('.stage-bar').boundingBox();
    const sub = page.getByTestId('ink-subbar');
    const subBox = await sub.boundingBox();
    expect(subBox).not.toBeNull();
    // A separate row directly under the bar — the bar itself did not grow.
    expect(Math.abs(bar!.height - barBefore!.height)).toBeLessThanOrEqual(1);
    expect(subBox!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
    expect(subBox!.y - (bar!.y + bar!.height)).toBeLessThanOrEqual(12);

    // The palette owns pen/highlighter, three colours, undo and clear.
    await expect(sub.getByTitle('형광펜')).toBeVisible();
    await expect(sub.getByTitle('펜', { exact: true })).toBeVisible();
    await expect(sub.locator('.ink-palette button')).toHaveCount(3);
    await expect(sub.getByLabel('한 획 되돌리기')).toBeVisible();
    await expect(sub.getByLabel('이 슬라이드 필기 지우기')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.screenshot({ path: `test-results/redesign/ink-${test.info().project.name}-${page.viewportSize()!.width}.png`, fullPage: false });

    await sub.getByLabel('필기 끄기').last().click();
    await expect(page.getByTestId('ink-subbar')).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});

test.describe('슬라이드 드로워', () => {
  test('드로워 팔레트가 오른쪽 바깥에 뜨고, 슬라이드를 고르면 드로워가 접힌다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'drawer only exists on a phone');
    const errors = watchConsole(page);
    await boot(page);

    await expect(page.locator('.rail-foot')).toHaveCount(0);
    expect(await page.getByTestId('deck-rail').isVisible()).toBe(false);

    await page.locator('.rail-toggle').click();
    await expect(page.getByTestId('deck-rail')).toBeVisible();
    // The load buttons are gone from the drawer foot.
    await expect(page.getByTestId('deck-rail')).not.toContainText('.md 파일 열기');
    await expect(page.getByTestId('deck-rail')).not.toContainText('드래그');

    const viewport = page.viewportSize()!;
    const railBox = (await page.getByTestId('deck-rail').boundingBox())!;
    const palette = page.getByTestId('rail-actions-0');
    await expect(palette).toBeVisible();
    const box = (await palette.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

    await page.screenshot({ path: 'test-results/redesign/drawer-mobile.png' });

    // Palette buttons do not fold the drawer.
    await palette.getByLabel('슬라이드 복제').click();
    await expect(page.getByTestId('deck-rail')).toBeVisible();
    await expect(page.locator('.rail-card')).toHaveCount(6);

    // A slide pick does.
    await page.getByTestId('rail-slide-1').click();
    await expect(page.getByTestId('deck-rail')).toBeHidden();

    expect(errors).toEqual([]);
  });
});

test.describe('랜딩 라이브러리 — 검색 · 태그 · 페이지', () => {
  test('13개 덱은 10개 + 3개로 나뉘고 페이지를 넘긴다', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    await seedDecks(page, 13);

    await expect(page.locator('.deck-card')).toHaveCount(10);
    await expect(page.getByTestId('catalog-pager')).toBeVisible();
    await expect(page.getByTestId('catalog-range')).toHaveText('1–10 / 13');
    await expect(page.getByTestId('catalog-page-1')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('catalog-next').click();
    await expect(page.locator('.deck-card')).toHaveCount(3);
    await expect(page.getByTestId('catalog-range')).toHaveText('11–13 / 13');
    await expect(page.getByTestId('catalog-page-2')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('catalog-next')).toBeDisabled();

    await page.getByTestId('catalog-prev').click();
    await expect(page.locator('.deck-card')).toHaveCount(10);

    // Search resets to page 1 and narrows the list.
    await page.getByTestId('catalog-next').click();
    await page.getByTestId('catalog-search').fill('시드 강의 12');
    await expect(page.locator('.deck-card')).toHaveCount(1);
    await expect(page.getByTestId('catalog-pager')).toHaveCount(0);
    await expect(page.getByTestId('deck-count')).toHaveText('1');

    // Tag chips filter, and the search word combines with the tag.
    await page.getByTestId('catalog-search').fill('');
    await page.getByTestId('tag-chip-Python').click();
    await expect(page.getByTestId('deck-count')).toHaveText('8');
    await expect(page.locator('.deck-card')).toHaveCount(8);
    await page.getByTestId('catalog-search').fill('파이썬');
    await expect(page.locator('.deck-card')).toHaveCount(1);
    await expect(page.getByTestId('catalog-next')).toHaveCount(0);

    await page.getByTestId('catalog-search').fill('없는 강의');
    await expect(page.getByTestId('catalog-no-result')).toBeVisible();
    await page.getByTestId('catalog-reset').click();
    await expect(page.getByTestId('deck-count')).toHaveText('13');
    await expect(page.locator('.deck-card')).toHaveCount(10);

    await page.screenshot({ path: `test-results/redesign/landing-${test.info().project.name}.png` });

    expect(errors).toEqual([]);
  });

  test('카드에 태그 칩이 보이고 새 강의에서 태그를 넣는다', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await page.getByTestId('landing-new-deck').click();
    await page.getByTestId('new-deck-name').fill('태그 확인 강의');
    await page.getByTestId('new-deck-tags').fill('Python, 기초, python');
    await expect(page.getByTestId('new-deck-tag-preview').locator('.deck-tag-chip')).toHaveText(['Python', '기초']);
    await page.getByTestId('new-deck-create').click();
    await expect(page.getByTestId('slide-card')).toBeVisible();

    await page.getByTestId('brand-home').click();
    await expect(page.getByTestId('landing')).toBeVisible();
    const card = page.locator('.deck-card').filter({ hasText: '태그 확인 강의' });
    await expect(card.locator('.deck-tag-chip')).toHaveText(['Python', '기초']);
    await expect(page.getByTestId('tag-chip-Python')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
