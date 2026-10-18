const PATHS: Record<string, string> = {
  map: 'M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-7 11a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm14 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM12 9v3m0 0-5.5 3M12 12l5.5 3',
  mind: 'M12 4c4.4 0 8 3.1 8 7 0 2.4-1.3 4.5-3.4 5.8L17 20l-3.6-1.6A9.6 9.6 0 0 1 12 18.5c-4.4 0-8-3.1-8-7.2C4 7.1 7.6 4 12 4Zm-3.5 7.5h.01M12 11.5h.01M15.5 11.5h.01',
  library: 'M5 4h3v16H5zM10.5 4h3v16h-3zM16 5l3 .8-3.6 14-3-.8z',
  trees: 'M12 3v18M12 8l-5-3M12 8l5-3M12 13l-6-2M12 13l6-2M12 18l-4-2M12 18l4-2',
  import: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm7.4 3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  chat: 'M4 5h16v10H9l-5 4z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.9.9 3 2.9 3 5.5',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM15.5 15.5 20 20',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6 6 18',
  phone: 'M6.6 3.5 9 3l1.6 4-2 1.4a11 11 0 0 0 5 5l1.4-2 4 1.6-.5 2.4a2 2 0 0 1-2 1.6A15 15 0 0 1 5 5.5a2 2 0 0 1 1.6-2Z',
  video: 'M4 7h11v10H4zM15 10.5 20 7v10l-5-3.5',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3',
  'mic-off': 'M4 4l16 16M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.6 2.5M18 12a6 6 0 0 1-1 3.3M6 12a6 6 0 0 0 9 5.2M12 18v3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  note: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  shield: 'M12 3 5 6v6c0 4.4 3 7.8 7 9 4-1.2 7-4.6 7-9V6z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M5 20h14',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M5 20h14',
  check: 'm5 12 4 4 10-10',
  warning: 'M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.4L4 8m0-4v4h4M4 13a8 8 0 0 0 14.6 4.4L20 16m0 4v-4h-4',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0',
};

export function Icon({ name, size = 20, label, className }: { name: keyof typeof PATHS | string; size?: number; label?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={className}
      focusable="false"
    >
      <path d={PATHS[name] ?? PATHS.note} />
    </svg>
  );
}
