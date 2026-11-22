import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

function Svg({ size = 18, children, fill = false }: IconProps & { children: ReactNode; fill?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconDeck = (p: IconProps) => (
  <Svg {...p}><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" /><path d="M4 12.5 12 17l8-4.5" /><path d="M4 17.2 12 21.6l8-4.4" /></Svg>
);
export const IconPlus = (p: IconProps) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const IconApps = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="4" width="6.4" height="6.4" rx="1.6" /><rect x="13.6" y="4" width="6.4" height="6.4" rx="1.6" /><rect x="4" y="13.6" width="6.4" height="6.4" rx="1.6" /><rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.6" /></Svg>
);
export const IconCode = (p: IconProps) => (<Svg {...p}><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /></Svg>);
export const IconCopy = (p: IconProps) => (
  <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2.2" /><path d="M15 5.6A2.6 2.6 0 0 0 12.4 3H6.6A2.6 2.6 0 0 0 4 5.6v5.8A2.6 2.6 0 0 0 6.6 14" /></Svg>
);
export const IconTrash = (p: IconProps) => (
  <Svg {...p}><path d="M4 6.5h16" /><path d="M9.5 4h5" /><path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" /><path d="M10 10.5v6M14 10.5v6" /></Svg>
);
export const IconUp = (p: IconProps) => (<Svg {...p}><path d="m6 14 6-6 6 6" /></Svg>);
export const IconDown = (p: IconProps) => (<Svg {...p}><path d="m6 10 6 6 6-6" /></Svg>);
export const IconPresent = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M12 16.5V21M8.5 21h7" /><path d="m10.5 8.2 4 2.1-4 2.1V8.2Z" /></Svg>
);
export const IconEye = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Svg>
);
/** 보기 모드: an open slide/page — never confused with the mask eye. */
export const IconBookOpen = (p: IconProps) => (
  <Svg {...p}><path d="M12 6.4C10.3 5.2 8.1 4.6 4.5 4.6v12.8c3.6 0 5.8.6 7.5 1.8 1.7-1.2 3.9-1.8 7.5-1.8V4.6c-3.6 0-5.8.6-7.5 1.8Z" /><path d="M12 6.4v13" /></Svg>
);
export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}><path d="M3 3l18 18" /><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.6 3.2" /><path d="M6.4 7.8A16 16 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 4-.8" /><path d="M9.9 10a3 3 0 0 0 4.1 4.2" /></Svg>
);
export const IconEdit = (p: IconProps) => (
  <Svg {...p}><path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0 0-3L18.5 4a2.1 2.1 0 0 0-3 0L4 15.5V20Z" /><path d="m14.5 5 4.5 4.5" /></Svg>
);
export const IconSplit = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M12 4.5v15" /></Svg>
);
export const IconSun = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></Svg>
);
export const IconMoon = (p: IconProps) => (<Svg {...p}><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" /></Svg>);
export const IconDots = (p: IconProps) => (<Svg {...p} fill><circle cx="12" cy="5.5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="18.5" r="1.6" /></Svg>);
export const IconExternal = (p: IconProps) => (
  <Svg {...p}><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H10" /></Svg>
);
export const IconDownload = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5v12" /><path d="m7.5 11 4.5 4.5 4.5-4.5" /><path d="M4.5 19.5h15" /></Svg>
);
export const IconUpload = (p: IconProps) => (
  <Svg {...p}><path d="M12 20.5v-12" /><path d="m7.5 13 4.5-4.5 4.5 4.5" /><path d="M4.5 4.5h15" /></Svg>
);
export const IconPrinter = (p: IconProps) => (
  <Svg {...p}><path d="M7 8.5V3.5h10v5" /><rect x="3.5" y="8.5" width="17" height="8.5" rx="2" /><path d="M7 14h10v6.5H7z" /></Svg>
);
export const IconHighlighter = (p: IconProps) => (
  <Svg {...p}><path d="m14 3.8 6.2 6.2-7.6 7.6H6.2L4 15.4 14 3.8Z" /><path d="M4 20.5h9" /></Svg>
);
export const IconPen = (p: IconProps) => (
  <Svg {...p}><path d="M4 20h4.2L20 8.2a2 2 0 0 0 0-2.8L18.6 4a2 2 0 0 0-2.8 0L4 15.8V20Z" /></Svg>
);
export const IconEraser = (p: IconProps) => (
  <Svg {...p}><path d="m4.5 14.5 6-9.6a2 2 0 0 1 2.8-.6l5.6 3.6a2 2 0 0 1 .6 2.8L14 19.5" /><path d="M4.5 14.5h11L18 19.5H8" /><path d="M9 19.5h10.5" /></Svg>
);
export const IconUndo = (p: IconProps) => (
  <Svg {...p}><path d="M4 9.5h9.5a5 5 0 0 1 0 10H8" /><path d="M7.5 5.5 3.5 9.5l4 4" /></Svg>
);
export const IconClose = (p: IconProps) => (<Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>);
export const IconFile = (p: IconProps) => (
  <Svg {...p}><path d="M13.5 3.5H7A2 2 0 0 0 5 5.5v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" /><path d="M13.5 3.5V9H19" /><path d="M8.5 13h7M8.5 16.5h5" /></Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></Svg>
);
export const IconPlay = (p: IconProps) => (<Svg {...p} fill><path d="M8 5.2v13.6L19 12 8 5.2Z" /></Svg>);
export const IconPause = (p: IconProps) => (<Svg {...p} fill><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></Svg>);
export const IconReset = (p: IconProps) => (
  <Svg {...p}><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v4.5h-4.5" /></Svg>
);
export const IconCheck = (p: IconProps) => (<Svg {...p}><path d="m4.5 12.5 5 5 10-11" /></Svg>);
export const IconLeft = (p: IconProps) => (<Svg {...p}><path d="m14.5 5-7 7 7 7" /></Svg>);
export const IconRight = (p: IconProps) => (<Svg {...p}><path d="m9.5 5 7 7-7 7" /></Svg>);
export const IconList = (p: IconProps) => (
  <Svg {...p}><path d="M4 6.5h3M4 12h3M4 17.5h3" /><path d="M10 6.5h10M10 12h10M10 17.5h10" /></Svg>
);
export const IconMenu = (p: IconProps) => (<Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>);
export const IconNote = (p: IconProps) => (
  <Svg {...p}><path d="M6 3.5h9L19 7.5v13H6z" /><path d="M14.5 3.5v4h4" /><path d="M9 12h6M9 15.5h4" /></Svg>
);
export const IconSpark = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9 12 3.5Z" /></Svg>
);
export const IconMask = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="6" width="18" height="6.5" rx="3.2" /><path d="M6 16.5c2 2.4 10 2.4 12 0" /></Svg>
);
export const IconHome = (p: IconProps) => (
  <Svg {...p}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.6v-6H9.6v6H5a1 1 0 0 1-1-1v-9.5Z" /></Svg>
);
export const IconHelp = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.6" /><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 1.9-2.5 3.5" /><path d="M12 16.7h.01" /></Svg>
);
export const IconSearch = (p: IconProps) => (
  <Svg {...p}><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.4 15.4 4.4 4.4" /></Svg>
);
export const IconTag = (p: IconProps) => (
  <Svg {...p}><path d="M4 11.6V5.4A1.4 1.4 0 0 1 5.4 4h6.2a1.4 1.4 0 0 1 1 .4l7 7a1.4 1.4 0 0 1 0 2l-5.2 5.2a1.4 1.4 0 0 1-2 0l-7-7a1.4 1.4 0 0 1-.4-1Z" /><circle cx="8.6" cy="8.6" r="1.3" fill="currentColor" stroke="none" /></Svg>
);

/** The HD2Lab dual-skew mark, drawn for the 56px title bar. */
export const BrandMark = ({ size = 30 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <path d="M15 20 35 10v33L15 53ZM29 24l20-10v33L29 57Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
  </svg>
);
