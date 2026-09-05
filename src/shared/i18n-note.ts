/**
 * The strings a NOTE needs, and only those.
 *
 * The content script is injected into every page that has a note on it, so what it carries
 * matters in a way the cabinet's bundle does not. When `t()` lived next to the whole catalogue
 * this bundle gained all three hundred and thirty entries -- the settings prose, the options
 * page, the popup -- and the budget caught it at 46.2 kB gz against a 36 kB ceiling.
 *
 * These are the fifty-odd keys a note's toolbar, placeholder and settings panel ask for. The
 * table is the SOURCE for them: `i18n.ts` imports and spreads it, so the cabinet and this
 * agree on the word for "Paper" by construction rather than by discipline.
 *
 * `tests/i18n.test.ts` asserts that every key the content script calls is in here -- because
 * a key that is only in the big catalogue would compile, ship, and render as its own name.
 */

import { type Entry, makeT } from './i18n-core.ts';

export { isRtl, type Lang, setLang } from './i18n-core.ts';

export const NOTE_CATALOGUE = {
  noteWhere: { en: 'Shows on', fa: 'نمایش روی' },
  noteWhereUrl: { en: 'This page', fa: 'همین صفحه' },
  noteWhereDomain: { en: 'This whole site', fa: 'کل این سایت' },
  noteWhereGlobal: { en: 'Every page', fa: 'همهٔ صفحه‌ها' },
  noteWhereNote: {
    en: 'A note on the whole site appears on every page of it, at the same place on each.',
    fa: 'نوتی که روی کل سایت باشد، در همهٔ صفحه‌های آن و در همان جای هر صفحه ظاهر می‌شود.',
  },
  noteEraseAll: { en: 'Erase everything', fa: 'پاک کردن همه' },
  noteName: { en: 'Name', fa: 'نام' },
  noteNamePlaceholder: { en: 'Untitled', fa: 'بی‌نام' },
  notePlaceholder: {
    en: 'Click to write. Markdown works.',
    fa: 'برای نوشتن کلیک کن. Markdown کار می‌کند.',
  },
  noteSettingsTitle: { en: 'Note settings', fa: 'تنظیمات نوت' },
  noteStrokeThickness: { en: 'Stroke thickness', fa: 'ضخامت خط' },
  noteThickness: { en: 'Thickness', fa: 'ضخامت' },
  noteToolCollapse: { en: 'Collapse (M)', fa: 'جمع کردن (M)' },
  noteToolColour: { en: 'Colour (C)', fa: 'رنگ (C)' },
  noteToolDelete: { en: 'Delete (Del)', fa: 'حذف (Del)' },
  noteToolDraw: { en: 'Draw (D)', fa: 'نقاشی (D)' },
  noteToolEraser: { en: 'Eraser (E)', fa: 'پاک‌کن (E)' },
  noteToolLock: { en: 'Lock (L)', fa: 'قفل (L)' },
  noteToolPen: { en: 'Pen (P)', fa: 'قلم (P)' },
  noteToolSettings: { en: 'Settings (S)', fa: 'تنظیمات (S)' },
  noteTypeHere: { en: 'Type. Markdown works.', fa: 'بنویس. Markdown کار می‌کند.' },
  setAccent: { en: 'Accent', fa: 'تأکید' },
  setAlign: { en: 'Align', fa: 'تراز' },
  setCentre: { en: 'Centre', fa: 'میانه' },
  setDefaultHint: {
    en: 'Every new note starts like this one',
    fa: 'هر نوت تازه مثل همین شروع می‌شود',
  },
  setDirAuto: { en: 'Auto (per paragraph)', fa: 'خودکار (هر پاراگراف)' },
  setDirLtr: { en: 'Left to right', fa: 'چپ به راست' },
  setDirRtl: { en: 'Right to left', fa: 'راست به چپ' },
  setDirection: { en: 'Direction', fa: 'جهت' },
  setEnd: { en: 'End', fa: 'انتها' },
  setFont: { en: 'Font', fa: 'فونت' },
  setFullPhysics: { en: 'Full paper physics', fa: 'فیزیک کامل کاغذ' },
  setGrain: { en: 'Grain', fa: 'دانه' },
  setInk: { en: 'Ink', fa: 'جوهر' },
  setLineHeight: { en: 'Line height', fa: 'ارتفاع خط' },
  setMaterial: { en: 'Material', fa: 'جنس' },
  setMotion: { en: 'Motion', fa: 'حرکت' },
  setNone: { en: 'None', fa: 'بدون' },
  setOff: { en: 'Off', fa: 'خاموش' },
  setOneCorner: { en: 'One corner', fa: 'یک گوشه' },
  setOpacity: { en: 'Opacity', fa: 'شفافیت' },
  setPalette: { en: 'Palette', fa: 'پالت' },
  setPaper: { en: 'Paper', fa: 'کاغذ' },
  setReduced: { en: 'Reduced', fa: 'کم' },
  setResetNote: { en: 'Reset this note', fa: 'بازنشانی این نوت' },
  setSaveDefault: { en: 'Save as my default', fa: 'ذخیره به‌عنوان پیش‌فرض من' },
  setShadow: { en: 'Shadow', fa: 'سایه' },
  setSize: { en: 'Size', fa: 'اندازه' },
  setStart: { en: 'Start', fa: 'ابتدا' },
  setTape: { en: 'Tape', fa: 'چسب' },
  setTornEdge: { en: 'Torn edge', fa: 'لبه‌ی پاره' },
  setTwoCorners: { en: 'Two corners', fa: 'دو گوشه' },
  setType: { en: 'Type', fa: 'نوشته' },
  setCustomHint: {
    en: 'Custom. Click to follow the default again.',
    fa: 'سفارشی. کلیک کن تا دوباره از پیش‌فرض پیروی کند.',
  },
} as const satisfies Record<string, Entry>;

export type NoteMessageKey = keyof typeof NOTE_CATALOGUE;

export const t = makeT(NOTE_CATALOGUE);
