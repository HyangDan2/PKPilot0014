import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/** Collects console errors and uncaught page errors for the whole test. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('notepad')).toBeVisible();
  await expect(page.getByTestId('slide-card')).toBeVisible();
}

/** A fresh deck has one slide with no note — the empty-note state. */
async function createEmptyDeck(page: Page, title: string) {
  await page.getByTestId('deck-button').click();
  await page.getByLabel('새 덱 이름').fill(title);
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByTestId('deck-button')).toContainText(title);
}

async function openExport(page: Page) {
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-export').click();
  await expect(page.getByTestId('export-modal')).toBeVisible();
}

interface SavedDownload {
  name: string;
  path: string;
}

async function pickAndDownload(page: Page, option: string): Promise<SavedDownload> {
  await page.getByTestId(`export-option-${option}`).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-confirm').click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const name = download.suggestedFilename();
  expect(name).toMatch(option === 'study' ? /\.study\.json$/ : option === 'zip' ? /\.zip$/ : /\.md$/);
  return { name, path: path! };
}

function downloadText(file: SavedDownload): string {
  return readFileSync(file.path, 'utf8');
}

test.describe('상단 바 · 화면 폭', () => {
  test('상단 바가 잘리지 않고 테마 · ⋮까지 한 줄에 들어온다', async ({ page }, testInfo) => {
    const errors = watchConsole(page);
    await boot(page);

    const viewport = page.viewportSize()!;
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      const buttons = [...document.querySelectorAll('.topbar-actions button, .topbar-actions a')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '', left: rect.left, right: rect.right };
        });
      const stageButtons = [...document.querySelectorAll('.stage-bar button')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '', left: rect.left, right: rect.right };
        });
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        topbar: box('.topbar'),
        stageBar: box('.stage-bar'),
        theme: box('[data-testid="theme-toggle"]'),
        menu: box('[data-testid="menu-button"]'),
        buttons,
        stageButtons,
      };
    });

    // No sideways overflow anywhere, and nothing sits past the right edge.
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.scrollWidth).toBe(viewport.width);
    for (const button of [...layout.buttons, ...layout.stageButtons]) {
      expect(button.right, `‘${button.name}’ 버튼이 오른쪽 밖으로 나갔습니다`).toBeLessThanOrEqual(viewport.width);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.name.length, '모든 아이콘 버튼에는 이름이 있어야 합니다').toBeGreaterThan(0);
    }
    expect(layout.menu!.right).toBeLessThanOrEqual(viewport.width);
    expect(layout.theme!.right).toBeLessThanOrEqual(viewport.width);

    // One row on desktop, one compact row on a phone (52px bar).
    expect(layout.topbar!.bottom - layout.topbar!.top).toBeLessThanOrEqual(56);
    expect(layout.stageBar!.bottom - layout.stageBar!.top).toBeLessThanOrEqual(
      testInfo.project.name === 'mobile' ? 52 : 56,
    );

    expect(errors).toEqual([]);
  });
});

test.describe('빈 메모 기본 안내', () => {
  test('PC 메모 영역에 여기에 메모하세요가 바로 보인다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'PC notepad only');
    const errors = watchConsole(page);
    await boot(page);
    await createEmptyDeck(page, '빈 메모 확인');

    const input = page.getByTestId('note-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', '여기에 메모하세요');
    await expect(page.getByTestId('slide-card')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('모바일 하단 메모 바에 흐린 여기에 메모하세요가 보인다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile drawer only');
    const errors = watchConsole(page);
    await boot(page);
    await createEmptyDeck(page, '빈 메모 확인');

    const hint = page.getByTestId('note-drawer-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('여기에 메모하세요');

    // The drawer keeps the same guidance once opened.
    await page.getByTestId('note-drawer-toggle').click();
    await expect(page.getByTestId('note-input')).toHaveAttribute('placeholder', '여기에 메모하세요');
    await page.getByTestId('note-drawer-close').click();

    await page.screenshot({ path: testInfo.outputPath(`empty-note-${testInfo.project.name}.png`) });
    expect(errors).toEqual([]);
  });
});

test.describe('통합 내보내기', () => {
  test('한 모달에서 다섯 가지 형식을 고른다', async ({ page }, testInfo) => {
    const errors = watchConsole(page);
    await boot(page);
    await openExport(page);

    for (const option of ['slides', 'notes', 'combined', 'zip', 'study']) {
      await expect(page.getByTestId(`export-option-${option}`)).toBeVisible();
    }
    await expect(page.getByTestId('export-option-combined')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('export-note-mode')).toBeVisible();

    for (const option of ['slides', 'notes', 'zip', 'study']) {
      await page.getByTestId(`export-option-${option}`).click();
      await expect(page.getByTestId(`export-option-${option}`)).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('export-note-mode')).toHaveCount(0);
    }

    await page.screenshot({ path: testInfo.outputPath('export-modal.png') });
    expect(errors).toEqual([]);
  });

  test('슬라이드 · 메모 · 합본 .md를 각각 내려받는다', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    await openExport(page);
    const slides = await pickAndDownload(page, 'slides');
    const slidesMd = downloadText(slides);
    expect(slidesMd).toContain('\n\n---\n\n');
    expect(slidesMd).not.toContain('<!-- note:');

    await openExport(page);
    const notes = await pickAndDownload(page, 'notes');
    const notesMd = downloadText(notes);
    expect(notesMd).toContain('슬라이드 메모');
    expect(notesMd).toContain('## 01.');
    expect(notesMd).not.toContain('```mermaid');

    await openExport(page);
    const combined = await pickAndDownload(page, 'combined');
    expect(downloadText(combined)).toContain('<!-- note:');

    expect(errors).toEqual([]);
  });

  test('ZIP 번들에 슬라이드 · 메모 · 전체 백업이 따로 들어 있다', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await openExport(page);
    const download = await pickAndDownload(page, 'zip');
    const zip = unzipSync(new Uint8Array(readFileSync(download.path)));
    const names = Object.keys(zip);

    expect(names).toHaveLength(3);
    expect(names.some((name) => name.endsWith('-slides.md'))).toBe(true);
    expect(names.some((name) => name.endsWith('-notes.md'))).toBe(true);
    expect(names.some((name) => name.endsWith('.study.json'))).toBe(true);

    const bySuffix = (suffix: string) => strFromU8(zip[names.find((name) => name.endsWith(suffix))!]);
    expect(bySuffix('-slides.md')).toContain('---');
    expect(bySuffix('-notes.md')).toContain('슬라이드 메모');
    const backup = JSON.parse(bySuffix('.study.json'));
    expect(backup.format).toBe('saga-glitra-study');
    expect(backup.decks.length).toBeGreaterThan(0);
    expect(backup.decks[0].slides[0]).toHaveProperty('note');

    expect(errors).toEqual([]);
  });

  test('전체 백업(.study.json)은 그대로 되돌릴 수 있다', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await openExport(page);
    const download = await pickAndDownload(page, 'study');
    const backup = JSON.parse(downloadText(download));
    expect(backup.format).toBe('saga-glitra-study');
    expect(backup.decks[0].slides.length).toBeGreaterThan(0);

    // Restore the file just written through the app's own importer.
    await page.getByTestId('menu-button').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('menu-restore').click();
    const fileChooser = await chooser;
    await fileChooser.setFiles(download.path);
    await expect(page.locator('.toast.on')).toContainText('백업을 복원했습니다');

    expect(errors).toEqual([]);
  });
});

