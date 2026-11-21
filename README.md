# Sága Glitra — HD2Lab Markdown Slide & Study Room

> **Sága**는 노르드 신화의 지혜의 여신, **Glitra**는 반짝임.
> 마크다운으로 덱을 만들고, 슬라이드마다 1:1로 묶인 노트·필기·가림막으로 외우는
> **100% 브라우저 로컬 공부방 스튜디오**입니다.

- 라이브: **https://hyangdan2.github.io/PKPilot0014/**
- 저장소: `HyangDan2/PKPilot0014` (Public)
- 서버 없음 · 업로드 0 B · 모든 데이터는 브라우저 `IndexedDB`에만 남습니다.

---

## 한 화면에 세 개의 방

| 방 | 무엇을 하는 곳 |
| --- | --- |
| **왼쪽 · 슬라이드 덱 레일** | `.md` 업로드/붙여넣기, `---` 또는 `##` 분할, 번호·제목·학습 상태 배지, 드래그·버튼 순서 이동, 추가/복제/삭제 |
| **가운데 · 슬라이드 스테이지** | 16:9 카드, `markdown-it` GFM + highlight.js + KaTeX + Mermaid + DOMPurify, 보기/편집/분할, **가림막 암기**, **형광펜/펜 필기 레이어** |
| **오른쪽 · 슬라이드 1:1 노트** | 지금 보는 슬라이드 `id`에 묶인 전용 마크다운 노트(넘기면 함께 전환), 덱 전체 요약 탭, **25:00 집중 타이머** |

## 기능

### 덱과 슬라이드
- `.md` 파일 선택 · 드래그앤드롭 · 붙여넣기로 새 덱 만들기 (`PKPilot0008` 마크다운·YAML frontmatter 호환)
- 슬라이드 분할 기준을 `---` 수평선(기본) 또는 `##` 헤딩으로 선택, 가져오기 전에 장수 미리보기
- 학습 상태 3단계 `미학습 → 복습 필요 → 이해 완료` 원클릭 순환
- 슬라이드 추가 · 복제 · 삭제 · 드래그 정렬 (`---` 안의 코드 펜스는 절대 쪼개지 않음)
- 덱 여러 개: 상단 `Sága Glitra` 배지를 눌러 전환, 새 덱, 샘플 복원, 덱 삭제

### 슬라이드 렌더링
- **GFM**: 표, 취소선, 체크리스트(`- [ ]`), 링크
- **코드 블록**: 언어 배지 + 복사 버튼 + highlight.js 강조
- **수식**: 인라인 `$E=mc^2$`, 블록 `$$ … $$` (KaTeX CSS/폰트 번들 포함 → 오프라인에서도 동일)
- **다이어그램**: ` ```mermaid ` 펜스 → 지연 로드 후 렌더
- **새니타이즈**: 렌더 결과는 DOMPurify를 통과, 원본 HTML은 마크다운으로 취급

### 가림막 암기 (`==키워드==`)
- `==텍스트==`를 빈칸 가림막칩으로 렌더 — 클릭/Enter 로 개별 공개·숨김
- 상단 `가림막 전체 공개 / 숨김` 토글, 가림막 개수 배지
- 코드 펜스·인라인 코드 안의 `==`는 건드리지 않음

### 형광펜 · 펜 필기
- 슬라이드 캔버스 위 SVG 오버레이에 직접 드로잉 (포인터·터치)
- 도구: 형광펜 / 펜, 색 3가지씩, 한 획 되돌리기, 슬라이드 필기 전체 지우기
- 좌표는 0–1 정규화로 저장 → 창 크기가 바뀌어도 제자리
- **슬라이드별로 `IndexedDB`에 자동 저장**, `.study.json` 백업에도 포함

### 발표 · 집중 모드
- `발표 모드(F5)`: 전체 화면, `←`/`→`/`Space`, 스와이프, `Esc` 종료, `N` 발표자 메모 토글
- 발표 중에도 가림막 전체 토글 가능

### 내보내기 · 인쇄
- **내보내기 한 곳(`⋮ → 내보내기`)**: 슬라이드만 · 메모만 · 슬라이드+메모 합본 · ZIP 번들 · 전체 백업
- **슬라이드 + 메모 합본 `.md`**: `---` 구분 + frontmatter, 노트를 `<!-- note: -->` / `> **노트**` 중 선택
- **ZIP 번들 `.zip`**: 슬라이드 `.md` · 메모 `.md` · `.study.json` 백업을 각각의 파일로 묶음 (fflate, 브라우저에서 생성)
- **`.study.json` 백업/복원**: 덱·노트·상태·필기 스트로크 전체, `⋮ → .study.json 복원`으로 100% 되돌림
- **학습지 PDF 인쇄**: `@media print` 전용 판면 — 슬라이드와 그 슬라이드의 노트를 2단으로, 덱 요약을 앞머리에

### 테마
- 기본 **Soft Iris(라이트)** — 공부방 눈 편안함
- 상단 토글로 **Navy & Lavender(다크)** 전환, `localStorage`(IndexedDB 설정)에 유지

## 시작하기

```bash
npm install
npm run dev        # http://localhost:5173/PKPilot0014/
npm test           # 69 unit tests (vitest + happy-dom)
npm run test:e2e   # Playwright E2E (1440×900 · 390×844, 빌드 후 dist 검사)
npm run build      # tsc --noEmit && vite build
npm run preview    # http://localhost:4173/PKPilot0014/
```

`npm run build` 전에 `prebuild`가 mermaid의 사전 빌드 번들을 `public/vendor/`로 복사합니다.
Mermaid는 번들에 넣지 않고, 다이어그램이 있는 슬라이드를 열 때 같은 출처에서 한 번만 불러옵니다(CDN 미사용).

브랜드 에셋 재생성:

```bash
python3 tools/generate_brand_assets.py    # favicon · icons · manifest · og-image(1200×630)
```

## 저장 구조

| 저장소 | 키 | 내용 |
| --- | --- | --- |
| IndexedDB `saga-glitra` / `workspace` | `current` | 덱 목록, 활성 덱·슬라이드, 설정(테마·보기·가림막·펜·타이머) |
| IndexedDB `saga-glitra` / `strokes` | `slideId` | 슬라이드별 필기 스트로크 |
| `.study.json` | — | `format: "saga-glitra-study"`, `version: 1` |

IndexedDB를 쓸 수 없는 환경(사생활 보호 모드, 테스트)에서는 같은 API가 메모리 저장소로 대체됩니다.

## 스택

Vite 6 · React 19 · TypeScript 5.7 · Vitest 3(happy-dom) · markdown-it 14 · highlight.js 11 ·
KaTeX 0.16 · Mermaid 11 · DOMPurify 3 · lz-string 1.5

## 배포

`main` 푸시 → GitHub Actions(`.github/workflows/deploy.yml`) → `tsc --noEmit` → `npm test` → `vite build` →
GitHub Pages(`https://hyangdan2.github.io/PKPilot0014/`).

## 라이선스

MIT © 2026 HD2Lab — [LICENSE](./LICENSE) · [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES.md)
