import { expect, test, type Page } from '@playwright/test';

/**
 * Third stabilization pass: the ink is only "saved" once its transaction
 * committed, a read that failed stops the room instead of looking like empty
 * ink, two tabs never overwrite each other silently, and the room survives
 * being closed the instant after an edit.
 *
 * Every case runs against the built site with the browser's real IndexedDB, so
 * a refused write is a real rollback and the storage assertions read what the
 * next load would read.
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

async function openStudio(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.getByTestId('landing-continue').click();
  await expect(page.getByTestId('slide-card')).toBeVisible();
}

/** Enters the studio on the page that is already open (no second load). */
async function continueFromLanding(page: Page): Promise<void> {
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

async function strokePaths(page: Page): Promise<string[]> {
  return page.locator('[data-testid="ink-layer"] svg.ink-canvas path').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('d') ?? ''),
  );
}

async function turnPenOn(page: Page): Promise<void> {
  await stageView(page, '보기').click();
  // The pen state rides along with the workspace, so a second tab can already
  // have it on.
  if (await page.getByTestId('ink-subbar').isVisible()) return;
  await page.getByTestId('pen-toggle').click();
  await expect(page.getByTestId('ink-subbar')).toBeVisible();
}

/** The notice bar sits over the stage bar; fold it before a stage click. */
async function dismissStorageNotice(page: Page): Promise<void> {
  const close = page.getByTestId('storage-notice-close');
  if (await close.isVisible().catch(() => false)) await close.click();
}

function saveChip(page: Page) {
  return page.getByTestId('save-status');
}

/** The stored stroke record for one slide, as the next load would read it. */
async function storedStrokes(page: Page, slideId: string): Promise<{ revision: number; count: number; paths: { id: string; points: { x: number; y: number }[] }[] } | null> {
  return page.evaluate((id) => new Promise((resolve) => {
    const request = indexedDB.open('saga-glitra', 1);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('strokes', 'readonly').objectStore('strokes').get(id);
      get.onsuccess = () => {
        db.close();
        const raw = get.result;
        if (raw === undefined) { resolve(null); return; }
        const record = Array.isArray(raw)
          ? { revision: 0, strokes: raw }
          : { revision: Number(raw?.revision) || 0, strokes: raw?.strokes ?? [] };
        resolve({
          revision: record.revision,
          count: record.strokes.length,
          paths: record.strokes.map((stroke: { id: string; points: { x: number; y: number }[] }) => ({ id: stroke.id, points: stroke.points })),
        });
      };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }), slideId);
}

/** The stored workspace record (the record itself, without the revision key). */
async function workspaceRecord(page: Page): Promise<any> {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('saga-glitra', 1);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
      get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }));
}

async function activeSlideId(page: Page): Promise<string> {
  const record = await workspaceRecord(page);
  return record?.activeSlideId ?? '';
}

async function textOfSlide(page: Page, title: string): Promise<string> {
  const record = await workspaceRecord(page);
  const deck = (record?.decks ?? []).find((item: { title: string }) => item.title === title);
  return deck?.slides?.[0]?.markdown ?? '';
}

/** Makes every ink (or workspace) write of this page fail like a full disk. */
async function refuseWrites(page: Page, store: 'strokes' | 'workspace', error = 'quota'): Promise<void> {
  await page.evaluate(({ storeName, kind }) => {
    const proto = IDBObjectStore.prototype;
    const holder = window as unknown as { __origPut?: IDBObjectStore['put'] };
    if (!holder.__origPut) holder.__origPut = proto.put;
    proto.put = function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === storeName || (storeName === 'workspace' && this.name === 'workspace')) {
        throw kind === 'quota'
          ? new DOMException('The quota has been exceeded.', 'QuotaExceededError')
          : new Error('write failed');
      }
      return holder.__origPut!.apply(this, args);
    } as typeof proto.put;
  }, { storeName: store, kind: error });
}

async function allowWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as { __origPut?: IDBObjectStore['put'] };
    if (holder.__origPut) IDBObjectStore.prototype.put = holder.__origPut;
  });
}

test.describe('3차 — 필기 저장 무결성', () => {
  test('필기 저장이 실패하면 dirty로 남고, 공간을 비운 뒤 다시 시도하면 새로고침까지 남는다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '마우스 필기');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '필기 재시도 덱');
    await turnPenOn(page);

    await refuseWrites(page, 'strokes');
    await drawStroke(page);
    await expect.poll(() => strokeCount(page)).toBe(1);

    // The transaction never committed: the chip says the ink is not saved and
    // the notice says why, but the stroke stays on the canvas as dirty work.
    await expect(saveChip(page)).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
    await expect(page.getByTestId('storage-notice')).toContainText('용량 초과');
    const slideId = await activeSlideId(page);
    expect(await storedStrokes(page, slideId)).toBeNull();

    // Space is freed; the retry commits the same dirty stroke.
    await allowWrites(page);
    await page.getByTestId('save-retry').click();
    await expect.poll(async () => (await saveChip(page).getAttribute('data-state')) ?? '', { timeout: 15_000 }).toBe('saved');
    await expect.poll(async () => (await storedStrokes(page, slideId))?.count ?? 0).toBe(1);
    const stored = await storedStrokes(page, slideId);
    expect(stored?.revision).toBe(1);

    // 그리고 새로고침 뒤에도 획이 그대로다.
    await reloadIntoStudio(page);
    await expect.poll(() => strokeCount(page)).toBe(1);
    expect(errors).toEqual([]);
  });

  test('필기를 하나라도 읽지 못하면 샘플 갱신도 워크스페이스 저장도 멈춘다', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '마우스 필기');
    await boot(page);
    await createDeck(page, '읽기 실패 보호 덱');
    await writeSlide(page, '## 보호\\n\\n읽기 실패 뒤에도 남아야 하는 본문');
    await turnPenOn(page);
    await drawStroke(page);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await expect.poll(async () => (await saveChip(page).getAttribute('data-state')) ?? '', { timeout: 15_000 }).toBe('saved');

    const before = await workspaceRecord(page);
    const beforeSlide = before.decks.find((deck: { title: string }) => deck.title === '읽기 실패 보호 덱');
    const slideId = beforeSlide.slides[0].id as string;

    // One ink record fails to read on the next load.
    await page.addInitScript((id) => {
      if (sessionStorage.getItem('slidedeck-ink-failure') !== '1') return;
      sessionStorage.removeItem('slidedeck-ink-failure');
      const proto = IDBObjectStore.prototype;
      const original = proto.get;
      proto.get = function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
        if (this.name === 'strokes' && args[0] === id) throw new Error('ink read failed');
        return original.apply(this, args);
      } as typeof original;
    }, slideId);
    await page.evaluate(() => sessionStorage.setItem('slidedeck-ink-failure', '1'));

    await page.reload();
    await expect(page.getByTestId('storage-notice')).toContainText('읽지 못했습니다');

    // The room is held still: the sample is on screen, but neither the sample
    // upgrade nor an autosave may reach the store.
    await continueFromLanding(page);
    await expect(saveChip(page)).toHaveAttribute('data-state', 'paused');
    await page.waitForTimeout(1500);
    const during = await workspaceRecord(page);
    expect(during.sampleDeckVersion).toBe(before.sampleDeckVersion);
    expect(during.decks.some((deck: { title: string }) => deck.title === '읽기 실패 보호 덱')).toBe(true);

    // A later load that can read everything shows the work intact.
    await page.goto('./');
    await expect(page.locator('.deck-card', { hasText: '읽기 실패 보호 덱' })).toHaveCount(1);
    await page.locator('.deck-card', { hasText: '읽기 실패 보호 덱' }).click();
    await expect(page.getByTestId('slide-card')).toBeVisible();
    await expect.poll(() => strokeCount(page)).toBe(1);
    expect(await slideMarkdown(page)).toContain('읽기 실패 뒤에도 남아야 하는 본문');
  });
});

test.describe('3차 — 두 탭', () => {
  test('필기 충돌은 저장본을 덮어쓰지 않고, 어느 쪽을 남길지 고르게 한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    const errors = watchConsole(page);
    await boot(page);
    await createDeck(page, '두 탭 충돌 덱');
    await writeSlide(page, '## 두 탭\\n\\n첫 탭의 본문');
    await turnPenOn(page);
    await drawStroke(page, 0);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await expect.poll(async () => (await saveChip(page).getAttribute('data-state')) ?? '', { timeout: 15_000 }).toBe('saved');
    const slideId = await activeSlideId(page);
    expect((await storedStrokes(page, slideId))?.count).toBe(1);
    const firstPaths = await strokePaths(page);

    // The second tab opens on the same room and sees both the deck and the ink.
    const second = await context.newPage();
    await openStudio(second);
    await expect(second.getByTestId('deck-button')).toContainText('두 탭 충돌 덱');
    await second.getByTestId('deck-button').click();
    await second.getByTestId('deck-menu').getByText('두 탭 충돌 덱').click();
    await expect(second.getByTestId('deck-button')).toContainText('두 탭 충돌 덱');
    await turnPenOn(second);
    await expect.poll(() => strokeCount(second)).toBe(1);
    expect(await strokePaths(second)).toEqual(firstPaths);

    // The second tab's own stroke cannot be written yet…
    await refuseWrites(second, 'strokes');
    await drawStroke(second, 1);
    await expect.poll(() => strokeCount(second)).toBe(2);
    await expect(second.getByTestId('save-status')).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
    // …and the store still holds only the first tab's ink.
    expect((await storedStrokes(page, slideId))?.count).toBe(1);
    await allowWrites(second);

    // …while the first tab draws again and its write lands.
    await drawStroke(page, 2);
    await expect.poll(async () => (await storedStrokes(page, slideId))?.count ?? 0).toBe(2);
    const firstTabPaths = await strokePaths(page);

    // The second tab retries from a stale revision: the room asks instead of
    // covering what the first tab stored.
    await second.getByTestId('save-retry').click();
    const conflict = second.getByTestId('conflict-notice');
    await expect(conflict).toBeVisible({ timeout: 20_000 });
    await expect(conflict).toContainText('다른 탭에서 먼저 저장했습니다');
    // Its own canvas is untouched, and the store still holds the first tab's ink.
    expect(await strokeCount(second)).toBe(2);
    expect(await strokePaths(second)).not.toEqual(firstTabPaths);
    expect((await storedStrokes(page, slideId))?.count).toBe(2);

    // Choosing the stored copy brings that ink onto this tab too.
    await second.getByTestId('conflict-load-stored').click();
    await expect(conflict).toHaveCount(0);
    await expect.poll(() => strokePaths(second)).toEqual(firstTabPaths);
    await expect(second.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');

    // From here the two tabs agree: a new stroke is written and the idle tab follows.
    await drawStroke(second, 0);
    await expect.poll(async () => (await storedStrokes(page, slideId))?.count ?? 0).toBe(3);
    await page.bringToFront();
    await expect.poll(() => strokeCount(page), { timeout: 20_000 }).toBe(3);
    expect(errors).toEqual([]);
    await second.close();
  });

  test('본문 충돌도 조용히 덮어쓰지 않고, 고른 쪽이 저장된다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    await boot(page);
    await createDeck(page, '본문 충돌 덱');
    await writeSlide(page, '## 본문\\n\\n첫 탭이 쓴 문장');
    await expect.poll(async () => textOfSlide(page, '본문 충돌 덱')).toContain('첫 탭이 쓴 문장');

    const second = await context.newPage();
    await openStudio(second);
    await second.getByTestId('deck-button').click();
    await second.getByTestId('deck-menu').getByText('본문 충돌 덱').click();
    await expect(second.getByTestId('deck-button')).toContainText('본문 충돌 덱');

    // This tab's save is refused, so its text stays dirty…
    await refuseWrites(second, 'workspace');
    await writeSlide(second, '## 본문\\n\\n둘째 탭이 쓴 문장');
    await expect(second.getByTestId('save-status')).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
    await allowWrites(second);
    expect(await textOfSlide(page, '본문 충돌 덱')).toContain('첫 탭이 쓴 문장');

    // …the first tab saves its own text in the meantime…
    await writeSlide(page, '## 본문\\n\\n그 사이 첫 탭이 고친 문장');
    await expect.poll(async () => textOfSlide(page, '본문 충돌 덱')).toContain('그 사이 첫 탭이 고친 문장');

    // …and the retry is refused instead of covering that save.
    await second.getByTestId('save-retry').click();
    await expect(second.getByTestId('conflict-notice')).toBeVisible({ timeout: 20_000 });
    expect(await textOfSlide(page, '본문 충돌 덱')).toContain('그 사이 첫 탭이 고친 문장');
    await dismissStorageNotice(second);
    expect(await slideMarkdown(second)).toContain('둘째 탭이 쓴 문장');

    // The person keeps this tab's text; only then does it land.
    await second.getByTestId('conflict-keep-local').click();
    await expect(second.getByTestId('conflict-notice')).toHaveCount(0);
    await expect.poll(async () => textOfSlide(page, '본문 충돌 덱')).toContain('둘째 탭이 쓴 문장');
    await expect(second.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await second.close();
  });
});

test.describe('3차 — 페이지 종료 직후 재접속', () => {
  test('메모를 적고 바로 탭을 닫아도 세 번 모두 남는다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '데스크톱 편집 경로');
    await boot(page);
    await createDeck(page, '닫기 반복 덱');

    let current = page;
    for (let round = 1; round <= 3; round += 1) {
      const text = `닫기 ${round}회차 메모`;
      await writeNote(current, text);
      // No wait for the debounce: the close has to write it.
      await current.close({ runBeforeUnload: true });
      current = await context.newPage();
      await openStudio(current);
      await expect.poll(() => noteValue(current)).toBe(text);
      expect(await textOfSlide(current, '닫기 반복 덱')).not.toBe('');
    }

    // The last round's work is in the store as a new load sees it.
    const record = await workspaceRecord(current);
    const deck = record.decks.find((item: { title: string }) => item.title === '닫기 반복 덱');
    expect(deck.slides[0].note).toBe('닫기 3회차 메모');
  });
});
