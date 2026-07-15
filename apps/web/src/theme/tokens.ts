export const theme = {
  color: {
    canvas: '#00143a',
    surface: '#062a4f',
    surfaceRaised: '#0a355f',
    border: '#35628f',
    borderMuted: 'rgba(88, 134, 181, 0.38)',
    text: '#f7fbff',
    textMuted: '#b8c9dc',
    accent: '#34d17b',
    accentStrong: '#20b96a',
    accentInk: '#031b25',
    gold: '#f4d65c',
    danger: '#ff8878',
    warning: '#ffd166',
    info: '#72b7f2',
    focus: '#ffffff',
  },
  radius: { sm: 8, md: 12, lg: 18, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 18, xl: 24, xxl: 32 },
  touchTarget: 44,
  motion: { fast: 120, normal: 180 },
} as const;

export type Theme = typeof theme;
