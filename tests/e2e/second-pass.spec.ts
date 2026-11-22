import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Second stabilization pass: the restore must leave *only* the backup's ink,
 * a deck deletion must either land whole or not at all, and a store that
 * cannot be read must never be overwritten with the sample.
 *
 * Everything here runs against the built site with the browser's real
 * IndexedDB, so a transaction that aborts is a real rollback.
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

async function notepadMode(page: Page, name: '편집' | '미리보기'): Promise<void> {
  const head = page.locator('.note-head');
  if (name === '편집' && !(await page.getByTestId('note-input').isVisible())) {
    await head.getByRole('tab', { name: '노트 편집' }).click();
  }
  if (name === '미리보기') await head.getByRole('tab', { name: '노트 미리보기' }).click();
}

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
  await expect(page.locator('.toast.on')).toContainText('복원');
}

async function importMarkdownText(page: Page, text: string): Promise<void> {
  await page.getByTestId('header-open-md').click();
  await page.getByTestId('md-paste').fill(text);
  await page.getByTestId('import-md').click();
  await expect(page.locator('.toast.on')).toContainText('가져왔습니다');
}

/** Every key in the strokes store, straight from IndexedDB. */
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

/** Writes one stroke record straight into the store, as an old build might. */
async function putStroke(page: Page, slideId: string): Promise<void> {
  const result = await page.evaluate((id) => new Promise<string>((resolve) => {
    const request = indexedDB.open('saga-glitra', 1);
    request.onerror = () => resolve(`open: ${request.error}`);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('strokes', 'readwrite');
      tx.objectStore('strokes').put([{ id: 'ghost', tool: 'pen', color: '#111', width: 2, points: [{ x: 0.1, y: 0.1 }] }], id);
      tx.oncomplete = () => { db.close(); resolve('ok'); };
      tx.onerror = () => { db.close(); resolve(`tx: ${tx.error}`); };
    };
  }), slideId);
  expect(result).toBe('ok');
}

/** The stored workspace record, as a plain object. */
async function workspaceRecord(page: Page): Promise<any> {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('saga-glitra', 1);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      let get: IDBRequest;
      try {
        // A page under test may patch get() to throw.
        get = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
      } catch {
        db.close();
        resolve(null);
        return;
      }
      get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }));
}

test.describe.configure({ mode: 'serial' });

test.describe('2차 안정화 — 원자적 복원과 삭제', () => {
  test('복원은 저장소의 남은 필기를 모두 지우고 복원본만 남긴다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '복원 정리 덱');
    await turnPenOn(page);
    await drawStroke(page);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await page.waitForTimeout(700);
    const inkIds = await strokeKeys(page);
    expect(inkIds.length).toBeGreaterThan(0);

    const backup = await exportAs(page, 'study');

    // Ink the person can still see nothing of: a record for a slide that is
    // not in any deck any more (what an older build can leave behind).
    await putStroke(page, 'sl_ghost_from_old_build');

    await restoreBackup(page, backup.path);
    await page.waitForTimeout(600);

    const keys = await strokeKeys(page);
    expect(keys).not.toContain('sl_ghost_from_old_build');
    expect(keys.sort()).toEqual(inkIds.sort());
    expect(errors).toEqual([]);
  });

  test('같은 슬라이드 ID라도 백업에 필기가 없으면 복원 뒤 사라진다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    await boot(page);
    await createDeck(page, '필기 없는 백업 덱');
    await page.waitForTimeout(700);
    // A backup of this deck with no ink on any slide.
    const backup = await exportAs(page, 'study');
    const parsed = JSON.parse(readFileSync(backup.path, 'utf8'));
    expect(Object.keys(parsed.strokes ?? {})).toHaveLength(0);
    const slideIds = parsed.decks.flatMap((deck: { slides: { id: string }[] }) => deck.slides.map((slide) => slide.id));
    expect(slideIds.length).toBeGreaterThan(0);

    await turnPenOn(page);
    await drawStroke(page);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await page.waitForTimeout(700);
    expect((await strokeKeys(page)).length).toBeGreaterThan(0);

    await restoreBackup(page, backup.path);
    await page.waitForTimeout(600);
    const keys = await strokeKeys(page);
    for (const id of slideIds) expect(keys).not.toContain(id);

    await reloadIntoStudio(page);
    await expect.poll(() => strokeCount(page)).toBe(0);
  });

  test('덱 삭제가 저장 중 실패하면 화면도 저장소도 그대로다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    page.on('dialog', (dialog) => void dialog.accept());
    await boot(page);
    await createDeck(page, '지워지지 않을 덱');
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
          const deck = (get.result?.decks ?? []).find((item: { title: string }) => item.title === '지워지지 않을 덱');
          resolve((deck?.slides ?? []).map((slide: { id: string }) => slide.id));
        };
        get.onerror = () => { db.close(); resolve([]); };
      };
      request.onerror = () => resolve([]);
    }));
    expect(doomedIds.length).toBeGreaterThan(0);

    // The transaction writes the workspace first and then hits the ink delete:
    // a real abort has to take the workspace put back with it.
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.delete;
      proto.delete = function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
        if (this.name === 'strokes') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return original.apply(this, args);
      } as typeof original;
    });

    await page.getByTestId('deck-button').click();
    await page.getByTestId('deck-menu').getByText('이 덱 삭제').click();
    await expect(page.locator('.toast.on')).toContainText('삭제하지 못했습니다');

    // The screen is put back: the deck is still the one being edited.
    await expect(page.getByTestId('deck-button')).toContainText('지워지지 않을 덱');
    for (const id of doomedIds) expect(await strokeKeys(page)).toContain(id);

    await page.evaluate(() => {
      // Restore the request method for the reload below.
      delete (IDBObjectStore.prototype as unknown as { delete?: unknown }).delete;
    });
    await page.reload();
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(page.locator('.deck-card', { hasText: '지워지지 않을 덱' })).toHaveCount(1);
    for (const id of doomedIds) expect(await strokeKeys(page)).toContain(id);
  });

  test('덱 삭제가 성공하면 덱도 필기도 함께 사라진다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    page.on('dialog', (dialog) => void dialog.accept());
    await boot(page);
    await createDeck(page, '원자적 삭제 덱');
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
          const deck = (get.result?.decks ?? []).find((item: { title: string }) => item.title === '원자적 삭제 덱');
          resolve((deck?.slides ?? []).map((slide: { id: string }) => slide.id));
        };
        get.onerror = () => { db.close(); resolve([]); };
      };
      request.onerror = () => resolve([]);
    }));

    await page.getByTestId('deck-button').click();
    await page.getByTestId('deck-menu').getByText('이 덱 삭제').click();
    await expect(page.locator('.toast.on')).toContainText('덱을 삭제했습니다');
    await page.waitForTimeout(500);

    const record = await workspaceRecord(page);
    expect(record.decks.some((deck: { title: string }) => deck.title === '원자적 삭제 덱')).toBe(false);
    const keys = await strokeKeys(page);
    for (const id of doomedIds) expect(keys).not.toContain(id);
  });
});

test.describe('2차 안정화 — 저장소를 읽지 못했을 때', () => {
  /** Fails the first workspace read of the next load only. */
  async function armReadFailure(page: Page): Promise<void> {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('slidedeck-arm-read-failure') !== '1') return;
      sessionStorage.removeItem('slidedeck-arm-read-failure');
      const proto = IDBObjectStore.prototype;
      const original = proto.get;
      let failed = false;
      proto.get = function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
        if (!failed && this.name === 'workspace') {
          failed = true;
          throw new Error('read failed once');
        }
        return original.apply(this, args);
      } as typeof original;
    });
    await page.evaluate(() => sessionStorage.setItem('slidedeck-arm-read-failure', '1'));
  }

  test('읽기 실패는 샘플로 덮어쓰지 않고, 다시 읽기로 저장본을 되찾는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 알림');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '지켜야 할 덱');
    await writeSlide(page, '## 지켜야 할 덱\n\n읽기 실패 뒤에도 남아야 하는 본문');
    await page.waitForTimeout(700);

    await armReadFailure(page);
    await page.reload();
    await expect(page.getByTestId('landing')).toBeVisible();

    const notice = page.getByTestId('storage-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('읽지 못했습니다');

    // Saving is paused: a debounce window or two must not put the sample over
    // the deck that is still stored.
    await page.getByTestId('landing-continue').click();
    await expect(page.getByTestId('slide-card')).toBeVisible();
    await page.waitForTimeout(1200);
    expect((await workspaceRecord(page)).decks.some((deck: { title: string }) => deck.title === '지켜야 할 덱')).toBe(true);

    // The store answers again; the retry adopts what is stored.
    await page.getByTestId('storage-read-retry').click();
    await expect(page.locator('.toast.on')).toContainText('다시 읽었습니다');
    await expect(page.getByTestId('deck-button')).toContainText('지켜야 할 덱');
    await expect.poll(async () => slideMarkdown(page)).toContain('읽기 실패 뒤에도 남아야 하는 본문');
    await expect(page.getByTestId('storage-notice')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('읽지 못한 채 새로고침해도 기존 덱은 남는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 알림');
    await boot(page);
    await createDeck(page, '새로고침 보존 덱');
    await writeSlide(page, '## 새로고침 보존\n\n덮어쓰이면 안 되는 문장');
    await page.waitForTimeout(700);

    await armReadFailure(page);
    await page.reload();
    await expect(page.getByTestId('storage-notice')).toContainText('읽지 못했습니다');
    await page.waitForTimeout(1200);

    // A fresh load without the failure reads what was stored all along.
    await page.goto('./');
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(page.locator('.deck-card', { hasText: '새로고침 보존 덱' })).toHaveCount(1);
    await page.locator('.deck-card', { hasText: '새로고침 보존 덱' }).click();
    await expect.poll(async () => slideMarkdown(page)).toContain('덮어쓰이면 안 되는 문장');
  });
});

test.describe('2차 안정화 — 저장 중 종료 · 두 탭 · 저장 오류', () => {
  test('노트를 적은 직후 새로고침해도 남는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    await boot(page);
    await createDeck(page, '즉시 종료 덱');
    await page.waitForTimeout(500);
    await writeNote(page, '디바운스를 기다리지 않고 닫아도 남는 메모');
    // No wait for the 350ms debounce: pagehide has to write it.
    await page.reload();
    await expect(page.getByTestId('landing')).toBeVisible();
    await page.getByTestId('landing-continue').click();
    await expect(page.getByTestId('slide-card')).toBeVisible();
    expect(await noteValue(page)).toBe('디바운스를 기다리지 않고 닫아도 남는 메모');
  });

  test('두 탭이 같은 방을 열어도 앞 탭의 저장을 덮어쓰지 않는다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    await boot(page);
    await createDeck(page, '첫 탭 덱');
    await writeSlide(page, '## 첫 탭 덱\n\n첫 탭에서 적은 문장');
    await page.waitForTimeout(800);

    const second = await context.newPage();
    await second.goto('./');
    await expect(second.getByTestId('landing')).toBeVisible();
    await second.getByTestId('landing-continue').click();
    await expect(second.getByTestId('slide-card')).toBeVisible();
    await second.waitForTimeout(800);

    // The first tab edits again while the second one is open.
    await writeSlide(page, '## 첫 탭 덱\n\n두 탭이 함께 봐도 남는 문장');
    await page.waitForTimeout(900);

    // The idle second tab follows that write instead of keeping its old copy.
    await expect.poll(async () => (await second.evaluate(() => new Promise<string>((resolve) => {
      const request = indexedDB.open('saga-glitra', 1);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
        get.onsuccess = () => {
          db.close();
          const deck = (get.result?.decks ?? []).find((item: { title: string }) => item.title === '첫 탭 덱');
          resolve(deck?.slides?.[0]?.markdown ?? '');
        };
        get.onerror = () => { db.close(); resolve(''); };
      };
      request.onerror = () => resolve('');
    })))).toContain('두 탭이 함께 봐도 남는 문장');

    // The second tab now makes its own deck; the first tab's text must survive.
    await createDeck(second, '둘째 탭 덱');
    await second.waitForTimeout(900);

    const record = await workspaceRecord(page);
    const first = record.decks.find((deck: { title: string }) => deck.title === '첫 탭 덱');
    expect(first?.slides?.[0]?.markdown).toContain('두 탭이 함께 봐도 남는 문장');
    expect(record.decks.some((deck: { title: string }) => deck.title === '둘째 탭 덱')).toBe(true);
    await second.close();
  });

  test('필기 저장이 실패해도 다음 글자 저장이 오류를 지우지 않는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 알림');
    await boot(page);
    await createDeck(page, '오류 유지 덱');
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.put;
      proto.put = function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'strokes') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return original.apply(this, args);
      } as typeof original;
    });
    await turnPenOn(page);
    await drawStroke(page);
    const notice = page.getByTestId('storage-notice');
    await expect(notice).toContainText('용량 초과');

    // A workspace write succeeds right after; the ink is still unsaved, so the
    // warning must stay. The note box sits below the banner, so this is a
    // normal edit, not a click through the notice.
    await writeNote(page, '본문은 저장된다');
    await page.waitForTimeout(900);
    await expect(notice).toContainText('용량 초과');
  });
});

test.describe('2차 안정화 — 합본 주석 노트의 특수 문자', () => {
  test('--- · 코드펜스 · --> 가 든 노트도 내보내 다시 가져오면 그대로다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 내보내기');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '특수 노트 덱');
    await writeSlide(page, '## 특수 노트\n\n본문은 그대로');
    const note = [
      '구분선을 적어 둔다',
      '',
      '---',
      '',
      '```ts',
      'const a = 1;',
      '---',
      '```',
      '',
      '주석을 닫는 --> 도 적었다',
    ].join('\n');
    await writeNote(page, note);
    await page.waitForTimeout(700);

    const file = await exportAs(page, 'combined', 'comment');
    const text = readFileSync(file.path, 'utf8');
    await importMarkdownText(page, text);

    await expect(page.getByTestId('deck-button')).toContainText('특수 노트 덱');
    expect(await noteValue(page)).toBe(note);
    expect(await slideMarkdown(page)).toBe('## 특수 노트\n\n본문은 그대로');
    expect(errors).toEqual([]);
  });
});
