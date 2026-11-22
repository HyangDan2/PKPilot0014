import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Stabilization checks (Phase 1–4): what the room keeps after a reload, what a
 * restore leaves behind, and what the screen says when the browser stops
 * storing. Each test starts from a clean profile so the workspace is the
 * sample deck and nothing else.
 */

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.getByTestId('landing-continue').click();
  await expect(page.getByTestId('slide-card')).toBeVisible();
}

async function reloadIntoStudio(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.getByTestId('landing-continue').click();
  await expect(page.getByTestId('slide-card')).toBeVisible();
}

async function createDeck(page: Page, title: string): Promise<void> {
  await page.getByTestId('deck-button').click();
  await page.getByLabel('새 덱 이름').fill(title);
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByTestId('deck-button')).toContainText(title);
}

/** The stage's 보기/편집/분할 tabs (the notepad has its own 편집 tab). */
function stageView(page: Page, name: '보기' | '편집' | '분할') {
  return page.locator('.stage-bar [aria-label="보기 모드"]').getByRole('tab', { name, exact: true });
}

async function writeSlide(page: Page, markdown: string): Promise<void> {
  await stageView(page, '편집').click();
  const editor = page.getByLabel('슬라이드 마크다운');
  await editor.fill(markdown);
  await expect(editor).toHaveValue(markdown);
}

async function slideMarkdown(page: Page): Promise<string> {
  await stageView(page, '편집').click();
  const value = await page.getByLabel('슬라이드 마크다운').inputValue();
  await stageView(page, '보기').click();
  return value;
}

/** The notepad's own 편집/미리보기 switch. */
async function notepadMode(page: Page, name: '편집' | '미리보기'): Promise<void> {
  const head = page.locator('.note-head');
  if (name === '편집' && !(await page.getByTestId('note-input').isVisible())) {
    await head.getByRole('tab', { name: '노트 편집' }).click();
  }
  if (name === '미리보기') await head.getByRole('tab', { name: '노트 미리보기' }).click();
}

/** Opens the phone's note drawer when this layout has one. */
async function openNotePanel(page: Page): Promise<void> {
  const toggle = page.getByTestId('note-drawer-toggle');
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute('aria-expanded')) === 'true') return;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function writeNote(page: Page, text: string): Promise<void> {
  await openNotePanel(page);
  await notepadMode(page, '편집');
  const input = page.getByTestId('note-input');
  await input.fill(text);
  await expect(input).toHaveValue(text);
}

async function noteValue(page: Page): Promise<string> {
  await openNotePanel(page);
  await notepadMode(page, '편집');
  const input = page.getByTestId('note-input');
  await expect(input).toBeVisible();
  return input.inputValue();
}

/** The sample deck puts its mermaid diagram on slide 3. */
async function goToDiagram(page: Page): Promise<void> {
  for (let step = 0; step < 4; step += 1) {
    if (await page.locator('[data-mermaid]').count()) return;
    await page.getByTestId('stage-next').click();
  }
  await expect(page.locator('[data-mermaid]').first()).toBeVisible();
}

/** A pen stroke across the 16:9 canvas, in viewport pixels. */
async function drawStroke(page: Page, offset = 0): Promise<void> {
  const box = await page.getByTestId('ink-layer').boundingBox();
  expect(box).not.toBeNull();
  const left = box!.x + box!.width * 0.2;
  const right = box!.x + box!.width * 0.7;
  const y = box!.y + box!.height * (0.3 + offset * 0.12);
  await page.mouse.move(left, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(left + ((right - left) * step) / 6, y + step * 2);
  }
  await page.mouse.up();
}

async function strokeCount(page: Page): Promise<number> {
  return page.locator('[data-testid="ink-layer"] svg.ink-canvas path').count();
}

async function turnPenOn(page: Page): Promise<void> {
  await stageView(page, '보기').click();
  await page.getByTestId('pen-toggle').click();
  await expect(page.getByTestId('ink-subbar')).toBeVisible();
}

async function openExport(page: Page): Promise<void> {
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-export').click();
  await expect(page.getByTestId('export-modal')).toBeVisible();
}

/** Downloads one export choice and returns its local path and suggested name. */
async function exportAs(page: Page, option: string, noteMode?: 'comment' | 'quote') {
  await openExport(page);
  await page.getByTestId(`export-option-${option}`).click();
  if (noteMode) {
    await page.getByTestId('export-note-mode').getByRole('button', { name: noteMode === 'quote' ? /인용 블록/ : /HTML 주석/ }).click();
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-confirm').click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return { path: path!, name: download.suggestedFilename() };
}

async function restoreBackup(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-restore').click();
  await (await chooser).setFiles(path);
  await expect(page.locator('.toast.on')).toContainText('백업을 복원했습니다');
}

async function importMarkdownText(page: Page, text: string): Promise<void> {
  await page.getByTestId('header-open-md').click();
  await page.getByTestId('md-paste').fill(text);
  await page.getByTestId('import-md').click();
  await expect(page.locator('.toast.on')).toContainText('가져왔습니다');
}


/**
 * Stops the running page from writing the workspace again, so a record seeded
 * straight into IndexedDB survives the reload (the room flushes its own state
 * on pagehide).
 */
async function freezeWorkspaceWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype;
    const original = proto.put;
    proto.put = function patched(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'workspace') {
        return { onsuccess: null, onerror: null } as unknown as IDBRequest;
      }
      return original.call(this, value, key);
    } as typeof original;
  });
}

/** Reads the whole strokes store straight from IndexedDB. */
async function strokeKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('saga-glitra', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('strokes', 'readonly');
      const keys = tx.objectStore('strokes').getAllKeys();
      keys.onsuccess = () => { db.close(); resolve(keys.result.map(String)); };
      keys.onerror = () => { db.close(); reject(keys.error); };
    };
  }));
}

test.describe('Phase 1 — 데이터 무결성', () => {
  test('덱을 만들고 편집한 뒤 새로고침해도 내용이 그대로다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '안정화 편집 덱');
    await writeSlide(page, '## 안정화 편집\n\n새로고침 뒤에도 남아야 하는 문장입니다.');
    await expect(page.getByTestId('slide-card')).toContainText('새로고침 뒤에도 남아야 하는 문장입니다.');

    await page.waitForTimeout(700);
    await reloadIntoStudio(page);
    expect(await slideMarkdown(page)).toContain('새로고침 뒤에도 남아야 하는 문장입니다.');
    expect(errors).toEqual([]);
  });

  test('필기를 남기고 재접속하면 획 수가 같다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '마우스 필기');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '필기 보존 덱');
    await turnPenOn(page);
    await drawStroke(page, 0);
    await drawStroke(page, 1);
    await expect.poll(() => strokeCount(page)).toBe(2);

    await page.waitForTimeout(700);
    await reloadIntoStudio(page);
    await expect(page.getByTestId('ink-layer')).toBeVisible();
    await expect.poll(() => strokeCount(page)).toBe(2);
    expect(errors).toEqual([]);
  });

  test('필기를 지우고 백업을 복원한 뒤 재접속해도 지운 상태다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '마우스 필기');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '필기 삭제 덱');
    await turnPenOn(page);
    await drawStroke(page);
    await expect.poll(() => strokeCount(page)).toBe(1);

    await page.getByRole('button', { name: '이 슬라이드 필기 지우기' }).click();
    await expect.poll(() => strokeCount(page)).toBe(0);
    await page.waitForTimeout(500);
    const backup = await exportAs(page, 'study');

    await restoreBackup(page, backup.path);
    await page.waitForTimeout(500);
    await expect.poll(() => strokeCount(page)).toBe(0);

    await reloadIntoStudio(page);
    await expect.poll(() => strokeCount(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('백업을 복원하면 새로고침 직후에도 복원본 그대로다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '복원 대상 덱');
    await writeSlide(page, '## 복원 대상\n\n복원 뒤에 보여야 하는 문장');
    await turnPenOn(page);
    await drawStroke(page);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await page.waitForTimeout(700);
    const backup = await exportAs(page, 'study');

    // Diverge from the backup: change the text and wipe the ink.
    await writeSlide(page, '## 복원 대상\n\n백업 이후에 고친 문장');
    await page.getByRole('button', { name: '이 슬라이드 필기 지우기' }).click();
    await expect.poll(() => strokeCount(page)).toBe(0);
    await page.waitForTimeout(700);

    await restoreBackup(page, backup.path);
    // Inside the debounce window on purpose: a restore must not wait for it.
    await page.waitForTimeout(120);
    await reloadIntoStudio(page);

    expect(await slideMarkdown(page)).toContain('복원 뒤에 보여야 하는 문장');
    expect(await slideMarkdown(page)).not.toContain('백업 이후에 고친 문장');
    await expect.poll(() => strokeCount(page)).toBe(1);
    expect(errors).toEqual([]);
  });

  test('덱을 지우면 백업과 저장소 어디에도 그 덱과 필기가 없다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    const errors = watchConsole(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await boot(page);
    await createDeck(page, '지워질 덱');
    await writeSlide(page, '## 지워질 덱\n\n사라져야 하는 본문');
    await turnPenOn(page);
    await drawStroke(page);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await page.waitForTimeout(700);

    const doomedIds = await page.evaluate(() => new Promise<string[]>((resolve) => {
      const request = indexedDB.open('saga-glitra', 1);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
        get.onsuccess = () => {
          db.close();
          const deck = (get.result?.decks ?? []).find((item: { title: string }) => item.title === '지워질 덱');
          resolve((deck?.slides ?? []).map((slide: { id: string }) => slide.id));
        };
        get.onerror = () => { db.close(); resolve([]); };
      };
      request.onerror = () => resolve([]);
    }));
    expect(doomedIds.length).toBeGreaterThan(0);

    await page.getByTestId('deck-button').click();
    await page.getByTestId('deck-menu').getByText('이 덱 삭제').click();
    await expect(page.locator('.toast.on')).toContainText('덱을 삭제했습니다');
    await page.waitForTimeout(700);

    const backup = await exportAs(page, 'study');
    const parsed = JSON.parse(readFileSync(backup.path, 'utf8'));
    expect(parsed.decks.some((deck: { title: string }) => deck.title === '지워질 덱')).toBe(false);
    const remainingIds = parsed.decks.flatMap((deck: { slides: { id: string }[] }) => deck.slides.map((slide) => slide.id));
    for (const id of doomedIds) expect(remainingIds).not.toContain(id);

    const keys = await strokeKeys(page);
    for (const id of doomedIds) expect(keys).not.toContain(id);
    expect(errors).toEqual([]);
  });

  test('샘플 덱에 남긴 메모는 버전이 올라가도 지워지지 않는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    const errors = watchConsole(page);
    await boot(page);
    await page.waitForTimeout(900);

    const seeded = await page.evaluate(() => new Promise<string>((resolve) => {
      const request = indexedDB.open('saga-glitra', 1);
      request.onerror = () => resolve(`open: ${request.error}`);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readwrite');
        const store = tx.objectStore('workspace');
        const get = store.get('current');
        get.onsuccess = () => {
          const saved = get.result;
          const sample = (saved?.decks ?? []).find((deck: { id: string }) => deck.id === 'sample-saga-glitra');
          if (!sample) { resolve('no-sample'); db.close(); return; }
          sample.slides[0].note = '샘플에 남긴 내 메모';
          sample.slides[1].status = 'done';
          const signature = JSON.stringify([
            sample.title,
            sample.summary,
            sample.slides.map((slide: { title: string; markdown: string; note: string; status: string }) => [slide.title, slide.markdown, slide.note, slide.status]),
          ]);
          saved.activeDeckId = sample.id;
          saved.activeSlideId = sample.slides[0].id;
          saved.sampleDeckVersion = 2;
          saved.sampleDeckFingerprint = signature;
          // The shipped sample's own signature, which the copy no longer matches.
          saved.sampleDeckBuildFingerprint = 'shipped-build-signature';
          saved.sampleDeckEdited = true;
          store.put(saved, 'current');
        };
        get.onerror = () => resolve(`get: ${get.error}`);
        tx.oncomplete = () => { db.close(); resolve('ok'); };
        tx.onerror = () => resolve(`tx: ${tx.error}`);
        tx.onabort = () => resolve('abort');
      };
    }));
    expect(seeded).toBe('ok');
    await freezeWorkspaceWrites(page);

    await page.reload();
    await expect(page.getByTestId('landing')).toBeVisible();
    await page.getByTestId('landing-continue').click();
    await expect(page.getByTestId('notepad')).toBeVisible();
    await expect(page.getByTestId('deck-button')).toContainText('SlideDeck 시작 덱');

    const note = await noteValue(page);
    expect(note).toBe('샘플에 남긴 내 메모');
    await expect(page.getByTestId('rail-status-1')).toContainText('완');
    expect(errors).toEqual([]);
  });

  test('손대지 않은 샘플 덱은 다음 빌드로 갱신된다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    await boot(page);
    await page.waitForTimeout(900);

    const seeded = await page.evaluate(() => new Promise<string>((resolve) => {
      const request = indexedDB.open('saga-glitra', 1);
      request.onerror = () => resolve('open');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readwrite');
        const store = tx.objectStore('workspace');
        const get = store.get('current');
        get.onsuccess = () => {
          const saved = get.result;
          const sample = (saved?.decks ?? []).find((deck: { id: string }) => deck.id === 'sample-saga-glitra');
          if (!sample) { resolve('no-sample'); db.close(); return; }
          const signature = JSON.stringify([
            sample.title,
            sample.summary,
            sample.slides.map((slide: { title: string; markdown: string; note: string; status: string }) => [slide.title, slide.markdown, slide.note, slide.status]),
          ]);
          saved.sampleDeckVersion = 2;
          saved.sampleDeckFingerprint = signature;
          saved.sampleDeckBuildFingerprint = signature;
          saved.sampleDeckEdited = false;
          store.put(saved, 'current');
        };
        tx.oncomplete = () => { db.close(); resolve('ok'); };
        tx.onerror = () => resolve('tx');
      };
    }));
    expect(seeded).toBe('ok');
    await freezeWorkspaceWrites(page);

    await page.reload();
    await expect(page.getByTestId('landing')).toBeVisible();
    await page.waitForTimeout(900);
    const version = await page.evaluate(() => new Promise<number | null>((resolve) => {
      const request = indexedDB.open('saga-glitra', 1);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
        get.onsuccess = () => { db.close(); resolve(get.result?.sampleDeckVersion ?? null); };
        get.onerror = () => { db.close(); resolve(null); };
      };
      request.onerror = () => resolve(null);
    }));
    expect(version).toBe(3);
  });
});

test.describe('Phase 2 — 저장·파일', () => {
  test('저장소를 열 수 없으면 임시 저장이라고 알린다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 알림');
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
    });
    await page.goto('./');
    const notice = page.getByTestId('storage-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('임시 저장');
    await expect(notice).toContainText('.study.json');

    // The room still opens and works; the warning is dismissible.
    await page.getByTestId('landing-continue').click();
    await expect(page.getByTestId('slide-card')).toBeVisible();
    await page.getByTestId('storage-notice-close').click();
    await expect(notice).toHaveCount(0);
  });

  test('저장 용량 초과를 화면에 알린다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 알림');
    await page.addInitScript(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function patched(this: IDBObjectStore) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      } as typeof original;
    });
    await page.goto('./');
    await expect(page.getByTestId('landing')).toBeVisible();
    await page.getByTestId('landing-continue').click();
    await expect(page.getByTestId('slide-card')).toBeVisible();
    const notice = page.getByTestId('storage-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('용량 초과');
  });

  test('합본 .md는 주석·인용 두 형식 모두 다시 가져올 수 있다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 내보내기');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '합본 왕복 덱');
    await writeSlide(page, '## 합본 왕복\n\n왕복 확인용 본문');
    await writeNote(page, '왕복 확인용 메모');
    await page.waitForTimeout(600);

    for (const mode of ['comment', 'quote'] as const) {
      const file = await exportAs(page, 'combined', mode);
      const text = readFileSync(file.path, 'utf8');
      expect(text).toContain('왕복 확인용 본문');
      expect(text).toContain(mode === 'quote' ? '> **노트**' : '<!-- note:');

      await importMarkdownText(page, text);
      await expect(page.getByTestId('deck-button')).toContainText('합본 왕복 덱');
      expect(await noteValue(page)).toBe('왕복 확인용 메모');
      expect(await slideMarkdown(page)).toContain('왕복 확인용 본문');
      expect(await slideMarkdown(page)).not.toContain('**노트**');
    }
    expect(errors).toEqual([]);
  });

  test('슬라이드만 내보낸 .md는 메모 없이 다시 들어온다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 내보내기');
    await boot(page);
    await createDeck(page, '슬라이드 전용 덱');
    await writeSlide(page, '## 슬라이드 전용\n\n본문만 남는지 확인');
    await writeNote(page, '이 메모는 내보내지 않는다');
    await page.waitForTimeout(600);

    const file = await exportAs(page, 'slides');
    expect(readFileSync(file.path, 'utf8')).not.toContain('이 메모는 내보내지 않는다');
    await importMarkdownText(page, readFileSync(file.path, 'utf8'));
    expect(await noteValue(page)).toBe('');
    expect(await slideMarkdown(page)).toContain('본문만 남는지 확인');
  });
});

test.describe('Phase 3 — 화면 정확성', () => {
  test('집중 타이머는 백그라운드에 다녀와도 흐른 시간을 그대로 센다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 타이머');
    await page.clock.install();
    await boot(page);
    const clock = page.getByTestId('timer-clock');
    await expect(clock).toHaveText('25:00');

    await page.getByRole('button', { name: '타이머 시작' }).click();
    await page.clock.fastForward(90_000);
    await expect(clock).toHaveText('23:30');

    // A hidden tab is where tick counting drifted; the deadline is unchanged.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.clock.fastForward(30_000);
    await expect(clock).toHaveText('23:00');

    await page.getByRole('button', { name: '타이머 일시정지' }).click();
    const paused = await clock.textContent();
    await page.clock.fastForward(20_000);
    await expect(clock).toHaveText(paused!);
  });

  test('테마를 바꾸면 mermaid 다이어그램이 새 테마로 다시 그려진다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 테마');
    const errors = watchConsole(page);
    await boot(page);
    await goToDiagram(page);
    const diagram = page.locator('[data-mermaid]').first();
    await expect(diagram).toHaveAttribute('data-rendered', 'true', { timeout: 20_000 });
    await expect(diagram).toHaveAttribute('data-rendered-theme', 'light');
    await expect(diagram.locator('svg')).toHaveCount(1);

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(diagram).toHaveAttribute('data-rendered-theme', 'dark', { timeout: 20_000 });
    await expect(diagram.locator('svg')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('mermaid 로딩이 한 번 실패해도 다시 시도해 그린다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 다이어그램');
    let attempts = 0;
    await page.route('**/vendor/mermaid.min.js', async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await boot(page);
    await goToDiagram(page);
    const diagram = page.locator('[data-mermaid]').first();
    await expect(diagram).toBeVisible();
    // The source stays readable while the library is missing…
    await expect(diagram.locator('.mermaid-src')).toHaveCount(1);
    // …and the retry draws the diagram without a reload.
    await expect(diagram).toHaveAttribute('data-rendered', 'true', { timeout: 25_000 });
    await expect(diagram.locator('svg')).toHaveCount(1);
    expect(attempts).toBeGreaterThan(1);
  });

  test('필기 중 슬라이드가 바뀌어도 획은 시작한 슬라이드에 남는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '마우스 필기');
    await boot(page);
    await createDeck(page, '필기 전환 덱');
    await page.getByTestId('add-slide').click();
    await expect(page.getByTestId('stage-count')).toContainText('2');
    await page.getByTestId('rail-slide-0').click();
    await turnPenOn(page);

    const box = await page.getByTestId('ink-layer').boundingBox();
    const left = box!.x + box!.width * 0.2;
    const y = box!.y + box!.height * 0.4;
    await page.mouse.move(left, y);
    await page.mouse.down();
    await page.mouse.move(left + 60, y + 10);
    // Move to the next slide before the pointer is lifted.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('stage-count')).toContainText('2');
    await page.mouse.up();

    await expect.poll(() => strokeCount(page)).toBe(0);
    await page.getByTestId('rail-slide-0').click();
    await expect.poll(() => strokeCount(page)).toBe(1);
  });

  test('모바일에서도 필기 · 드로워 · 페이지 이동이 이어진다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', '390×844 전용');
    const errors = watchConsole(page);
    await boot(page);
    await expect(page.getByTestId('stage-count')).toContainText('1');
    await page.getByTestId('stage-next').click();
    await expect(page.getByTestId('stage-count')).toContainText('2');

    // The drawer opens, takes a note and folds again.
    await page.getByTestId('note-drawer-toggle').click();
    await expect(page.getByTestId('note-drawer-toggle')).toHaveAttribute('aria-expanded', 'true');
    await notepadMode(page, '편집');
    const noteInput = page.getByTestId('note-input');
    await expect(noteInput).toBeVisible();
    await noteInput.fill('모바일 메모 저장 확인');
    await expect(noteInput).toHaveValue('모바일 메모 저장 확인');
    await page.getByTestId('note-drawer-close').click();

    const box = await page.getByTestId('ink-layer').boundingBox();
    await page.getByTestId('pen-toggle').click();
    await expect(page.getByTestId('ink-subbar')).toBeVisible();
    const left = box!.x + box!.width * 0.25;
    const y = box!.y + box!.height * 0.45;
    await page.mouse.move(left, y);
    await page.mouse.down();
    await page.mouse.move(left + 70, y + 6, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => strokeCount(page)).toBe(1);

    await page.waitForTimeout(700);
    await reloadIntoStudio(page);
    // Opening from the landing starts at the first slide; the work stays on 2.
    await page.getByTestId('stage-next').click();
    await expect(page.getByTestId('stage-count')).toContainText('2/5');
    await expect.poll(() => strokeCount(page)).toBe(1);
    await page.getByTestId('note-drawer-toggle').click();
    expect(await noteValue(page)).toContain('모바일 메모 저장 확인');
    expect(errors).toEqual([]);
  });
});

test.describe('Phase 3 — 내보내기 오류 전달', () => {
  test('내보내기가 실패하면 알린다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 내보내기');
    await boot(page);
    // Blob creation is where a download dies in a locked-down browser.
    await page.evaluate(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = () => { throw new Error('blocked by policy'); };
      (window as unknown as { __restoreCreate: () => void }).__restoreCreate = () => { URL.createObjectURL = original; };
    });
    await openExport(page);
    await page.getByTestId('export-option-study').click();
    await page.getByTestId('export-confirm').click();
    await expect(page.locator('.toast.on')).toContainText('내보내지 못했습니다');
    await page.evaluate(() => (window as unknown as { __restoreCreate: () => void }).__restoreCreate());
  });

  test('손상된 백업은 이유를 말하고 복원하지 않는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 복원');
    await boot(page);
    const dir = mkdtempSync(join(tmpdir(), 'slidedeck-bad-'));
    const path = join(dir, 'broken.study.json');
    writeFileSync(path, JSON.stringify({
      format: 'saga-glitra-study',
      version: 1,
      decks: [
        { id: 'd1', title: 'A', slides: [{ id: 'dup', markdown: 'x', note: '', status: 'unlearned' }] },
        { id: 'd2', title: 'B', slides: [{ id: 'dup', markdown: 'y', note: '', status: 'unlearned' }] },
      ],
      strokes: {},
    }));
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('menu-button').click();
    await page.getByTestId('menu-restore').click();
    await (await chooser).setFiles(path);
    await expect(page.locator('.toast.on')).toContainText('중복된 ID');
    await expect(page.getByTestId('deck-button')).toContainText('SlideDeck 시작 덱');
  });
});
