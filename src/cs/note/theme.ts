/**
 * The look: 1990s graffiti and photocopied zine.
 *
 * Colour never appears in an SVG filter or a canvas -- filters here only ever produce
 * alpha/luminance, and the grain tile is a multiply blend. That means re-theming a note is
 * four custom-property writes with no filter regeneration and no repaint of the art layers.
 *
 * Shades are derived with `color-mix(in oklab, ...)` rather than by darkening RGB, because
 * these are saturated acid colours and naive RGB darkening turns every one of them to mud.
 */

export interface Palette {
  id: string;
  /** Shown in the picker. */
  label: string;
  paper: string;
  ink: string;
  accent: string;
}

export const PALETTES: readonly Palette[] = [
  { id: 'postit', label: 'Post-it', paper: '#ffe94a', ink: '#14110e', accent: '#ff2e63' },
  { id: 'riso-pink', label: 'Riso pink', paper: '#ff8fb8', ink: '#1b0d16', accent: '#00d5c8' },
  { id: 'acid', label: 'Acid lime', paper: '#c6ff3d', ink: '#10160a', accent: '#7a2ff7' },
  { id: 'cyan', label: 'Photocopy cyan', paper: '#7ef0ff', ink: '#06181d', accent: '#ff5b17' },
  { id: 'traffic', label: 'Traffic orange', paper: '#ff8a3d', ink: '#1d0f05', accent: '#0f2fd6' },
  { id: 'violet', label: 'Ultraviolet', paper: '#b79bff', ink: '#150c2b', accent: '#c6ff3d' },
  { id: 'newsprint', label: 'Newsprint', paper: '#f0e7d2', ink: '#181613', accent: '#c01b3a' },
  { id: 'carbon', label: 'Carbon', paper: '#1e1b17', ink: '#f2ede0', accent: '#ffe94a' },
] as const;

export const DEFAULT_PALETTE = PALETTES[0] as Palette;

/*
 * Re-exported, so a caller that wants a note's style and its type in one import still can.
 * The table itself lives in `shared/` because the background and the build need it too, and
 * neither of them should be reaching into the note renderer.
 */
export {
  FONTS,
  type FontChoice,
  type FontFile,
  faceFamily,
  faceFile,
  fontById,
  fontStack,
} from '~/shared/fonts.ts';

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? DEFAULT_PALETTE;
}

/** Everything a single note can override. A stored note keeps only the fields it changed. */
export interface NoteStyle {
  palette: string;
  /** Custom colours win over the palette when set. */
  paper?: string;
  ink?: string;
  accent?: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  dir: 'auto' | 'ltr' | 'rtl';
  align: 'start' | 'center' | 'end';
  opacity: number;
  /** 0 disables the torn edge and gives a clean rectangle. */
  tornEdges: number;
  grain: number;
  tape: 'none' | 'one' | 'two';
  shadow: 'none' | 'soft' | 'hard';
  physics: 'full' | 'reduced' | 'off';
}

export const DEFAULT_STYLE: Readonly<NoteStyle> = Object.freeze({
  palette: 'postit',
  fontFamily: 'system',
  fontSize: 15,
  lineHeight: 1.45,
  dir: 'auto',
  align: 'start',
  opacity: 1,
  tornEdges: 2.4,
  grain: 0.16,
  tape: 'one',
  shadow: 'hard',
  physics: 'full',
});

/** Resolve a sparse per-note override against the user's defaults. */
export function resolveStyle(
  override: Partial<NoteStyle> | undefined,
  defaults: NoteStyle = DEFAULT_STYLE as NoteStyle,
): NoteStyle {
  return { ...defaults, ...override };
}

/** The custom properties a resolved style maps to. Writing these is the whole re-theme. */
export function styleVars(s: NoteStyle, fontStack: string): Record<string, string> {
  const p = paletteById(s.palette);
  return {
    '--cn-paper': s.paper ?? p.paper,
    '--cn-ink': s.ink ?? p.ink,
    '--cn-accent': s.accent ?? p.accent,
    '--cn-font': fontStack,
    '--cn-size': `${s.fontSize}px`,
    '--cn-lh': String(s.lineHeight),
    '--cn-opacity': String(s.opacity),
    '--cn-grain': String(s.grain),
  };
}

/**
 * Is this paper dark enough that ink-coloured overlays need inverting?
 * Rec. 709 relative luminance on the sRGB values -- good enough to pick a blend mode, and it
 * avoids pulling in a colour library for one decision.
 */
export function isDarkPaper(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = Number.parseInt(m[1] as string, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}
