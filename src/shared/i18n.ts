/**
 * Translation.
 *
 * `browser.i18n.getMessage` is the right API inside the extension, but the dev harnesses run
 * as ordinary pages where `browser` does not exist -- so this wraps it and falls back to a
 * bundled English table. That keeps the harnesses honest: they show the same strings the
 * extension will, and a missing key is visible in development rather than at review time.
 *
 * The catalogue below is the source of truth. `pnpm build` writes it out to
 * `_locales/<lang>/messages.json`, so there is one place to add a string and no chance of the
 * two drifting.
 */

export type Lang = 'en' | 'fa';

export interface Entry {
  en: string;
  fa: string;
  /** Shown to translators and to AMO reviewers. */
  note?: string;
}

/**
 * Every user-visible string.
 *
 * Persian is not a transliteration of the English -- a couple of the phrasings only work
 * idiomatically one way round, and the close-warning copy in particular has to be honest
 * about being best-effort in both languages.
 */
export const CATALOGUE = {
  extName: { en: 'Chevalet Note', fa: 'شوالیه‌نوت' },
  extDescription: {
    en: 'Sticky notes that stay stuck to the page — not to your browser. Offline, private, and yours to export.',
    fa: 'استیکی‌نوت‌هایی که به خودِ صفحه می‌چسبند، نه به مرورگر. آفلاین، خصوصی، و همیشه قابل خروجی‌گرفتن.',
  },

  // commands
  cmdNewNote: { en: 'New note on this page', fa: 'نوت تازه روی این صفحه' },
  cmdToggleTab: {
    en: 'Turn notes on or off for this tab',
    fa: 'روشن/خاموش کردن نوت‌ها برای این تب',
  },
  cmdCycleNotes: { en: 'Focus the next note', fa: 'رفتن به نوت بعدی' },
  cmdOpenManager: { en: 'Open the note manager', fa: 'باز کردن مدیریت نوت‌ها' },

  // context menu
  menuNewNote: { en: 'Add a note here', fa: 'یک نوت اینجا بچسبان' },
  menuNoteOnSelection: { en: 'Add a note on this text', fa: 'یک نوت روی این متن' },
  menuOpenManager: { en: 'All my notes…', fa: 'همهٔ نوت‌های من…' },

  // updates
  updatesTitle: { en: 'Updates', fa: 'به‌روزرسانی' },
  updatesCheck: { en: 'Check for a new version', fa: 'بررسی نسخهٔ جدید' },
  updatesChecking: { en: 'Checking…', fa: 'در حال بررسی…' },
  updatesCurrent: { en: 'You have the latest version.', fa: 'آخرین نسخه را داری.' },
  updatesAvailable: { en: 'Version $1 is available.', fa: 'نسخهٔ $1 موجود است.' },
  updatesOpen: { en: 'Open the release page', fa: 'باز کردن صفحهٔ انتشار' },
  updatesDaily: { en: 'Check once a day', fa: 'روزی یک بار بررسی کن' },
  updatesFailed: { en: 'Could not check just now.', fa: 'الان نشد بررسی کنم.' },
  updatesDenied: {
    en: 'Access to the release list was not granted, so there is nothing to check against.',
    fa: 'دسترسی به فهرست انتشارها داده نشد، پس چیزی برای مقایسه نیست.',
  },

  // note toolbar
  noteDraw: { en: 'Draw', fa: 'ترسیم' },
  noteSettings: { en: 'Settings', fa: 'تنظیمات' },
  noteColour: { en: 'Next colour', fa: 'رنگ بعدی' },
  noteLock: { en: 'Lock', fa: 'قفل' },
  noteCollapse: { en: 'Collapse', fa: 'جمع کردن' },
  noteExpand: { en: 'Expand', fa: 'باز کردن' },
  noteDelete: { en: 'Delete', fa: 'حذف' },
  notePen: { en: 'Pen', fa: 'قلم' },
  noteEraser: { en: 'Eraser', fa: 'پاک‌کن' },
  noteThickness: { en: 'Thickness', fa: 'ضخامت' },
  noteEraseAll: { en: 'Erase everything', fa: 'پاک کردن همه' },
  noteDrawingHint: { en: 'drawing — Esc to stop', fa: 'در حال ترسیم — Esc برای خروج' },
  notePlaceholder: {
    en: 'Click to write. Markdown works.',
    fa: 'برای نوشتن کلیک کن. Markdown کار می‌کند.',
  },

  // settings panel
  setPaper: { en: 'Paper', fa: 'کاغذ' },
  setType: { en: 'Type', fa: 'نوشته' },
  setMaterial: { en: 'Material', fa: 'جنس' },
  setPalette: { en: 'Palette', fa: 'پالت' },
  setInk: { en: 'Ink', fa: 'جوهر' },
  setAccent: { en: 'Accent', fa: 'تأکید' },
  setFont: { en: 'Font', fa: 'فونت' },
  setSize: { en: 'Size', fa: 'اندازه' },
  setLineHeight: { en: 'Line height', fa: 'ارتفاع خط' },
  setDirection: { en: 'Direction', fa: 'جهت' },
  setDirAuto: { en: 'Auto (per paragraph)', fa: 'خودکار (هر پاراگراف)' },
  setDirLtr: { en: 'Left to right', fa: 'چپ به راست' },
  setDirRtl: { en: 'Right to left', fa: 'راست به چپ' },
  setAlign: { en: 'Align', fa: 'تراز' },
  setOpacity: { en: 'Opacity', fa: 'شفافیت' },
  setTornEdge: { en: 'Torn edge', fa: 'لبه‌ی پاره' },
  setGrain: { en: 'Grain', fa: 'دانه' },
  setTape: { en: 'Tape', fa: 'چسب' },
  setShadow: { en: 'Shadow', fa: 'سایه' },
  setMotion: { en: 'Motion', fa: 'حرکت' },
  setSaveDefault: { en: 'Save as my default', fa: 'ذخیره به‌عنوان پیش‌فرض من' },
  setResetNote: { en: 'Reset this note', fa: 'بازنشانی این نوت' },
  setCustomHint: {
    en: 'Custom. Click to follow the default again.',
    fa: 'سفارشی. کلیک کن تا دوباره از پیش‌فرض پیروی کند.',
  },

  // options
  optTitle: { en: 'Settings', fa: 'تنظیمات' },
  optSettingsLive: { en: 'Settings live in the cabinet', fa: 'تنظیمات در کابینت است' },
  optSettingsLiveNote: {
    en:
      'Every setting is in one place, and this is not it. The cabinet holds where notes ' +
      'appear, how they look, what happens when a tab closes, how long the trash is kept, ' +
      'backup, the language, and the whole keyboard reference. This page is what Firefox ' +
      'opens from its add-ons list, so it keeps the way in, the version, and the two notes ' +
      'below about what your notes survive and what leaves your machine — which is nothing.',
    fa:
      'همهٔ تنظیمات در یک جا هستند و آن جا این صفحه نیست. کابینت این‌ها را دارد: نوت‌ها کجا ' +
      'ظاهر شوند، چه شکلی باشند، وقتی تبی بسته می‌شود چه اتفاقی بیفتد، سطل زباله چند روز ' +
      'نگه داشته شود، بکاپ، زبان، و راهنمای کامل کلیدها. این صفحه همان چیزی است که فایرفاکس ' +
      'از فهرست افزونه‌هایش باز می‌کند، پس فقط راه ورود، شمارهٔ نسخه، و دو یادداشت پایین را ' +
      'دارد: نوت‌هایت از چه چیزهایی جان سالم می‌برند، و چه چیزی از دستگاهت بیرون می‌رود — که ' +
      'هیچ چیز.',
  },
  optOpenCabinet: { en: 'Open the cabinet', fa: 'کابینت را باز کن' },
  optWhereNotes: { en: 'Where notes appear', fa: 'نوت‌ها کجا ظاهر شوند' },
  optCloseWarning: { en: 'Warning before a tab closes', fa: 'هشدار قبل از بسته شدن تب' },
  optKeeping: { en: 'Keeping and deleting', fa: 'نگه‌داری و حذف' },
  optBackup: { en: 'Backup', fa: 'بکاپ' },
  optSurvives: { en: 'What your notes survive', fa: 'نوت‌هایت از چه چیزهایی جان سالم می‌برند' },
  optPrivacy: { en: 'Privacy', fa: 'حریم خصوصی' },
  optSaved: { en: 'Saved.', fa: 'ذخیره شد.' },
  optLanguage: { en: 'Language', fa: 'زبان' },
  optFollowBrowser: { en: 'Follow the browser', fa: 'پیروی از مرورگر' },

  // manager
  mgrTitle: { en: 'Cabinet', fa: 'کمد' },
  mgrSearch: { en: 'Search every note…', fa: 'جستجو در همه‌ی نوت‌ها…' },
  mgrAllNotes: { en: 'All notes', fa: 'همه‌ی نوت‌ها' },
  mgrTrash: { en: 'Trash', fa: 'سطل زباله' },
  mgrBackToNotes: { en: 'Back to notes', fa: 'بازگشت به نوت‌ها' },
  mgrCabinetView: { en: 'Cabinet', fa: 'کمد' },
  mgrListView: { en: 'List', fa: 'فهرست' },
  mgrExport: { en: 'Export ZIP', fa: 'خروجی ZIP' },
  mgrExportSelection: { en: 'Export selection', fa: 'خروجی انتخاب‌شده‌ها' },
  mgrImport: { en: 'Import…', fa: 'ورود…' },
  mgrSelected: { en: 'selected', fa: 'انتخاب‌شده' },
  mgrClear: { en: 'Clear', fa: 'پاک کردن' },
  mgrRestore: { en: 'Restore', fa: 'بازیابی' },
  mgrMoveToTrash: { en: 'Move to trash', fa: 'انتقال به سطل زباله' },
  mgrDeleteForever: { en: 'Delete forever', fa: 'حذف همیشگی' },
  mgrUntitled: { en: '(untitled)', fa: '(بی‌عنوان)' },
  mgrEmptyDrawer: { en: 'This drawer is empty', fa: 'این کشو خالی است' },
  mgrEmptyHint: {
    en: 'Stick a note on a page and it files itself here.',
    fa: 'یک نوت روی صفحه بچسبان تا خودش اینجا بایگانی شود.',
  },
  mgrNoMatch: { en: 'Nothing matches that', fa: 'چیزی با این پیدا نشد' },
  mgrNoMatchHint: {
    en: 'Try fewer words, or clear the search.',
    fa: 'کلمات کمتری امتحان کن، یا جستجو را پاک کن.',
  },
  mgrTrashHint: {
    en: 'Deleted notes wait here for 30 days.',
    fa: 'نوت‌های حذف‌شده ۳۰ روز اینجا می‌مانند.',
  },
  mgrNotes: { en: 'notes', fa: 'نوت' },
  mgrSites: { en: 'sites', fa: 'سایت' },
  mgrInTrash: { en: 'in trash', fa: 'در سطل زباله' },
  mgrCancel: { en: 'Cancel', fa: 'انصراف' },

  // import
  impTitle: { en: 'Import archive', fa: 'ورود آرشیو' },
  impNothingWritten: {
    en: 'Nothing has been written yet.',
    fa: 'هنوز چیزی نوشته نشده است.',
  },
  impKeepNewest: { en: 'Keep newest', fa: 'جدیدترین را نگه دار' },
  impArchiveWins: { en: 'Archive wins', fa: 'آرشیو اولویت دارد' },
  impAsCopies: { en: 'Import as copies', fa: 'ورود به‌عنوان کپی' },
  impNew: { en: 'new', fa: 'جدید' },
  impUpdated: { en: 'updated', fa: 'به‌روزشده' },
  impSkipped: { en: 'left alone (already newer here)', fa: 'دست‌نخورده (نسخه‌ی اینجا جدیدتر است)' },

  // popup
  popEnabled: { en: 'Notes on for this tab', fa: 'نوت‌ها برای این تب روشن' },
  popDisabled: { en: 'Notes off for this tab', fa: 'نوت‌ها برای این تب خاموش' },
  popNewNote: { en: 'New note', fa: 'نوت تازه' },
  popOpenCabinet: { en: 'Open cabinet', fa: 'باز کردن کمد' },
  popGrantSite: { en: 'Allow on this site', fa: 'اجازه در این سایت' },
  popGrantDomain: { en: 'Allow on this domain', fa: 'اجازه در این دامنه' },
  popGrantAll: { en: 'Allow on all sites', fa: 'اجازه در همه‌ی سایت‌ها' },
  popNoAccess: {
    en: 'Chevalet Note has no access to this site yet.',
    fa: 'شوالیه‌نوت هنوز به این سایت دسترسی ندارد.',
  },
  popReopen: { en: 'Reopen', fa: 'باز کردن مجدد' },
  popClosedWithNotes: { en: 'Closed with notes', fa: 'با نوت بسته شد' },

  // the close guard -- the wording has to be honest in both languages
  guardWillWarn: {
    en: 'Will warn before this tab closes.',
    fa: 'قبل از بسته شدن این تب هشدار می‌دهد.',
  },
  guardBestEffort: {
    en: 'Close warnings are best-effort: browsers only allow them on pages you have interacted with. Your notes are saved either way.',
    fa: 'هشدار بستن تب «تا حد امکان» است: مرورگرها فقط در صفحه‌هایی اجازه می‌دهند که با آن‌ها تعامل داشته‌ای. نوت‌هایت در هر صورت ذخیره می‌شوند.',
    note: 'Shown in options next to the close-warning setting. Must not over-promise.',
  },
  guardModeNever: { en: 'Never warn', fa: 'هرگز هشدار نده' },
  guardModeUnsaved: {
    en: 'Warn if there are unsaved edits',
    fa: 'اگر تغییر ذخیره‌نشده هست هشدار بده',
  },
  guardModeHasNotes: {
    en: 'Warn whenever the page has notes',
    fa: 'هر وقت صفحه نوت دارد هشدار بده',
  },

  // durability, stated plainly
  durabilitySurvives: {
    en: 'Your notes survive clearing your browsing data.',
    fa: 'نوت‌های تو با پاک کردن داده‌های مرورگر از بین نمی‌روند.',
  },
  durabilityLost: {
    en: 'They are lost by "Refresh Firefox" or by uninstalling the extension — which is what the ZIP backup is for.',
    fa: 'با «Refresh Firefox» یا حذف اکستنشن از بین می‌روند — و بکاپ ZIP دقیقاً برای همین است.',
  },
} as const satisfies Record<string, Entry>;

export type MessageKey = keyof typeof CATALOGUE;

let lang: Lang = 'en';

/** Pick a language. `''` means follow the browser. */
export function setLang(explicit: Lang | ''): void {
  if (explicit) {
    lang = explicit;
    return;
  }
  const ui = typeof navigator === 'undefined' ? 'en' : navigator.language;
  lang = ui.startsWith('fa') ? 'fa' : 'en';
}

export function isRtl(): boolean {
  return lang === 'fa';
}

/**
 * Look up a message.
 *
 * Inside the extension this defers to `browser.i18n`, so Firefox's own locale negotiation and
 * the `_locales` files are what actually ship. Outside it -- the dev harnesses -- it reads the
 * catalogue directly. A key that is missing from both returns the key itself, which is ugly on
 * purpose: an untranslated string should be obvious in development.
 */
export function t(key: MessageKey, ...substitutions: string[]): string {
  const native = readNative(key, substitutions);
  if (native) return native;
  const entry = CATALOGUE[key] as Entry | undefined;
  if (!entry) return key;
  return fill(entry[lang] ?? entry.en, substitutions);
}

function readNative(key: string, substitutions: string[]): string | null {
  try {
    if (typeof browser === 'undefined' || !browser.i18n?.getMessage) return null;
    const value = browser.i18n.getMessage(key, substitutions);
    return value || null;
  } catch {
    return null;
  }
}

function fill(template: string, substitutions: string[]): string {
  return template.replace(/\$(\d)/g, (_, i) => substitutions[Number(i) - 1] ?? '');
}

/** The shape `_locales/<lang>/messages.json` expects. Used by the build. */
export function toMessagesJson(
  target: Lang,
): Record<string, { message: string; description?: string }> {
  const out: Record<string, { message: string; description?: string }> = {};
  for (const [key, entry] of Object.entries(CATALOGUE) as Array<[string, Entry]>) {
    out[key] = entry.note
      ? { message: entry[target], description: entry.note }
      : { message: entry[target] };
  }
  return out;
}
