export type StudyStatus = 'unlearned' | 'review' | 'done';

export const STATUS_ORDER: StudyStatus[] = ['unlearned', 'review', 'done'];

export const STATUS_SHORT: Record<StudyStatus, string> = {
  unlearned: '미',
  review: '복',
  done: '완',
};

export const STATUS_LABEL: Record<StudyStatus, string> = {
  unlearned: '미학습',
  review: '복습 필요',
  done: '이해 완료',
};

export interface Slide {
  id: string;
  title: string;
  markdown: string;
  note: string;
  status: StudyStatus;
}

export interface Deck {
  id: string;
  title: string;
  slides: Slide[];
  summary: string;
  /** Short labels for the landing library: search, tag filter, card chips. */
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type StrokeTool = 'highlighter' | 'pen';

export interface InkPoint {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  tool: StrokeTool;
  color: string;
  width: number;
  points: InkPoint[];
}

export type StrokesBySlide = Record<string, Stroke[]>;

export type SplitMode = 'hr' | 'heading';
export type ViewMode = 'view' | 'edit' | 'split';
export type NoteTab = 'slide' | 'deck';
export type Theme = 'light' | 'dark';

export interface StudioSettings {
  theme: Theme;
  splitMode: SplitMode;
  viewMode: ViewMode;
  noteTab: NoteTab;
  maskAll: boolean;
  penOn: boolean;
  tool: StrokeTool;
  color: string;
  timerMinutes: number;
}

export interface StudyFile {
  format: 'saga-glitra-study';
  version: 1;
  app: 'SlideDeck';
  exportedAt: string;
  activeDeckId: string;
  decks: Deck[];
  strokes: StrokesBySlide;
}

export const DEFAULT_SETTINGS: StudioSettings = {
  theme: 'light',
  splitMode: 'hr',
  viewMode: 'view',
  noteTab: 'slide',
  maskAll: true,
  penOn: false,
  tool: 'highlighter',
  color: '#f5c542',
  timerMinutes: 25,
};

export const INK_COLORS: Record<StrokeTool, { name: string; value: string }[]> = {
  highlighter: [
    { name: '옐로', value: '#f5c542' },
    { name: '민트', value: '#4fd1a5' },
    { name: '라벤더', value: '#a78bfa' },
  ],
  pen: [
    { name: '잉크', value: '#23203a' },
    { name: '로즈', value: '#e0567a' },
    { name: '블루', value: '#3b76e8' },
  ],
};
