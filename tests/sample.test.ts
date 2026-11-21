import { describe, expect, it } from 'vitest';
import { splitMarkdown } from '../src/lib/split';
import { createDeck, createSlide } from '../src/lib/study';
import {
  LEGACY_SAMPLE_MARKDOWN, SAMPLE_DECK_ID, SAMPLE_DECK_SUMMARY, SAMPLE_DECK_TITLE, SAMPLE_MARKDOWN,
  SAMPLE_VERSION, createSampleDeck, sampleDeckSignature, shouldUpgradeSampleDeck, upgradeSampleDecks,
} from '../src/lib/sample';
import type { Deck, StrokesBySlide } from '../src/types/study';

function legacyDeck(): Deck {
  const slides = splitMarkdown(LEGACY_SAMPLE_MARKDOWN, 'hr')
    .map((chunk) => createSlide(chunk.markdown, chunk.note, chunk.title));
  const deck = createDeck(SAMPLE_DECK_TITLE, slides);
  deck.id = 'deck_legacy';
  deck.summary = SAMPLE_DECK_SUMMARY;
  return deck;
}

describe('샘플 덱 — 첫 장 슬림화', () => {
  const deck = createSampleDeck();

  it('다섯 장짜리 샘플 덱을 만든다', () => {
    expect(deck.slides).toHaveLength(5);
    expect(deck.id).toBe(SAMPLE_DECK_ID);
    expect(deck.title).toBe(SAMPLE_DECK_TITLE);
  });

  it('첫 장에는 핵심 소개만 남고 사용법 목록·콜아웃이 없다', () => {
    const first = deck.slides[0].markdown;
    expect(first).toContain('공부방 스튜디오');
    expect(first).not.toContain('왼쪽 레일');
    expect(first).not.toContain('가운데: 16:9');
    expect(first).not.toContain('이 덱은 지우지 않고');
    expect(first).not.toContain('- ');
    expect(first).not.toContain('>');
    // 제목 + 소개 두 줄, 그 이상은 부풀리지 않는다.
    const prose = first.split('\n').filter((line) => line.trim() && !line.startsWith('#') && !line.startsWith('<!--'));
    expect(prose.length).toBeLessThanOrEqual(2);
  });

  it('나머지 학습 장은 그대로 남는다', () => {
    expect(deck.slides[1].markdown).toContain('$E = mc^2$');
    expect(deck.slides[4].markdown).toContain('==키워드==');
  });

  it('샘플 마크다운은 v2이고 이전본과 다르다', () => {
    expect(SAMPLE_VERSION).toBe(2);
    expect(SAMPLE_MARKDOWN).not.toBe(LEGACY_SAMPLE_MARKDOWN);
  });
});

describe('샘플 덱 버전 갱신 — 사용자 데이터 보호', () => {
  it('이전 버전 표시가 없는 손대지 않은 샘플은 현재 샘플로 갱신된다', () => {
    const result = upgradeSampleDecks([legacyDeck()], {}, {});
    expect(result.upgraded).toBe(true);
    expect(result.decks[0].id).toBe(SAMPLE_DECK_ID);
    expect(result.decks[0].slides[0].markdown).not.toContain('왼쪽 레일');
  });

  it('사용자가 수정한 샘플은 덮어쓰지 않는다', () => {
    const deck = legacyDeck();
    deck.slides[2].markdown += '\n\n내가 정리한 내용';
    const result = upgradeSampleDecks([deck], {}, {});
    expect(result.upgraded).toBe(false);
    expect(result.decks[0].slides[2].markdown).toContain('내가 정리한 내용');
  });

  it('필기가 있는 샘플은 덮어쓰지 않는다', () => {
    const deck = legacyDeck();
    const strokes: StrokesBySlide = {
      [deck.slides[0].id]: [{ id: 's1', tool: 'pen', color: '#000', width: 2, points: [{ x: 1, y: 1 }] }],
    };
    const result = upgradeSampleDecks([deck], {}, strokes);
    expect(result.upgraded).toBe(false);
  });

  it('현재 버전으로 기록된 샘플은 다시 갱신하지 않는다', () => {
    const deck = createSampleDeck();
    const result = upgradeSampleDecks([deck], {
      version: SAMPLE_VERSION,
      fingerprint: sampleDeckSignature(deck),
    }, {});
    expect(result.upgraded).toBe(false);
  });

  it('버전이 낮고 내용이 그대로면 갱신한다', () => {
    const deck = createSampleDeck();
    const upgraded = shouldUpgradeSampleDeck({
      deck,
      storedVersion: SAMPLE_VERSION - 1,
      storedFingerprint: sampleDeckSignature(deck),
      hasInk: false,
    });
    expect(upgraded).toBe(true);
  });

  it('버전이 낮아도 내용 서명이 다르면 갱신하지 않는다', () => {
    const deck = createSampleDeck();
    deck.slides[1].note = '내 메모';
    const upgraded = shouldUpgradeSampleDeck({
      deck,
      storedVersion: SAMPLE_VERSION - 1,
      storedFingerprint: sampleDeckSignature(createSampleDeck()),
      hasInk: false,
    });
    expect(upgraded).toBe(false);
  });

  it('샘플이 아닌 덱은 버전이 낮아도 건드리지 않는다', () => {
    const deck = legacyDeck();
    deck.id = 'deck_mine';
    const upgraded = shouldUpgradeSampleDeck({
      deck,
      storedVersion: 1,
      storedFingerprint: sampleDeckSignature(deck),
      hasInk: false,
    });
    expect(upgraded).toBe(false);
  });
});
