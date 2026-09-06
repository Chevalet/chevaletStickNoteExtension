/**
 * Translation.
 *
 * The catalogue below is the source of truth, and it is read directly -- see the note on `t()`
 * for why `browser.i18n` is not consulted at run time. `pnpm build` writes the catalogue out to
 * `_locales/<lang>/messages.json` for the MANIFEST, whose name and description Firefox resolves
 * itself; so there is one place to add a string and no chance of the two drifting.
 *
 * English is the default. "Follow the browser" is a choice a person makes, not the starting
 * state: a note-taking tool that comes up in a language you did not ask for is startling, and
 * the language lives in the cabinet under Backup.
 *
 * ## Adding a language
 *
 * Three steps, and no busywork:
 *
 *   1. Add it to `Lang` in `i18n-core.ts`.
 *   2. Add the column to the entries you have translated. `Entry` requires English and makes
 *      every other language optional, so a half-finished language works from the first string
 *      -- `t()` falls back to English per key, and so does the `_locales` the build writes.
 *   3. Offer it in the Language row of the cabinet's Backup pane, and in the popup.
 *
 * `tests/i18n.test.ts` asserts that PERSIAN stays complete, because it is. The optional shape
 * is for a language arriving, not for one rotting.
 */

import { type Entry, type Lang, makeT } from './i18n-core.ts';
import { NOTE_CATALOGUE } from './i18n-note.ts';

export type { Entry, Lang } from './i18n-core.ts';
export { isRtl, setLang } from './i18n-core.ts';

/**
 * Every user-visible string.
 *
 * Persian is not a transliteration of the English -- a couple of the phrasings only work
 * idiomatically one way round, and the close-warning copy in particular has to be honest
 * about being best-effort in both languages.
 */
export const CATALOGUE = {
  /*
   * The note's own strings, from the table the CONTENT SCRIPT imports.
   *
   * Spread rather than repeated: the cabinet and a note say "Paper" about the same thing, and
   * two copies of that word in two languages is two chances to disagree. See `i18n-note.ts`
   * for why the split exists at all -- the budget, measured.
   */
  ...NOTE_CATALOGUE,

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
  noteDrawingHint: { en: 'drawing — Esc to stop', fa: 'در حال ترسیم — Esc برای خروج' },

  // settings panel

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
  mgrTitle: { en: 'Cabinet', fa: 'کابینت' },
  mgrSearch: { en: 'Search every note…', fa: 'جستجو در همه‌ی نوت‌ها…' },
  mgrAllNotes: { en: 'All notes', fa: 'همه‌ی نوت‌ها' },
  mgrTrash: { en: 'Trash', fa: 'سطل زباله' },
  mgrBackToNotes: { en: 'Back to notes', fa: 'بازگشت به نوت‌ها' },
  mgrCabinetView: { en: 'Cabinet', fa: 'کابینت' },
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
  popOpenCabinet: { en: 'Open cabinet', fa: 'باز کردن کابینت' },
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

  // the cabinet
  cabAllNotes: { en: 'All notes', fa: 'همهٔ نوت‌ها' },
  cabTrash: { en: 'Trash', fa: 'سطل زباله' },
  cabSettings: { en: 'Settings', fa: 'تنظیمات' },
  cabBackToNotes: { en: 'Back to notes', fa: 'برگشت به نوت‌ها' },
  cabCabinet: { en: 'Cabinet', fa: 'کابینت' },
  cabList: { en: 'List', fa: 'فهرست' },
  cabSearchPlaceholder: { en: 'Search every note…', fa: 'در همهٔ نوت‌ها بگرد…' },
  cabSearchLabel: { en: 'Search notes', fa: 'جست‌وجوی نوت‌ها' },
  cabExport: { en: 'Export…', fa: 'خروجی…' },
  cabImport: { en: 'Import…', fa: 'ورودی…' },
  cabRename: { en: 'Rename…', fa: 'تغییر نام…' },
  cabEdit: { en: 'Edit…', fa: 'ویرایش…' },
  cabEditTitle: { en: 'Edit this note', fa: 'ویرایش این نوت' },
  cabEditNote: {
    en: 'Markdown, the same as in the note itself. Saving keeps the previous text as a version, so History can put it back.',
    fa: 'Markdown، همان‌طور که در خود نوت. با ذخیره‌کردن، متن قبلی به‌عنوان یک نسخه نگه داشته می‌شود تا از تاریخچه برگردانی‌اش.',
  },
  cabCouldNotSave: { en: 'Could not save', fa: 'ذخیره نشد' },
  cabHistory: { en: 'History…', fa: 'تاریخچه…' },
  cabRestore: { en: 'Restore', fa: 'بازگرداندن' },
  cabMoveToTrash: { en: 'Move to trash', fa: 'انداختن در سطل' },
  cabDeleteForever: { en: 'Delete forever', fa: 'حذف همیشگی' },
  cabClear: { en: 'Clear', fa: 'پاک کردن' },
  cabCancel: { en: 'Cancel', fa: 'بی‌خیال' },
  cabSave: { en: 'Save', fa: 'ذخیره' },
  cabUntitled: { en: 'Untitled', fa: 'بی‌نام' },
  cabNote: { en: 'Note', fa: 'نوت' },
  cabPage: { en: 'Page', fa: 'صفحه' },
  cabUpdated: { en: 'Updated', fa: 'آخرین تغییر' },
  cabEmptyDrawer: { en: 'This drawer is empty', fa: 'این کشو خالی است' },
  cabEmptyAll: {
    en: 'Stick a note on a page and it files itself here.',
    fa: 'یک نوت روی صفحه‌ای بچسبان؛ خودش همین‌جا بایگانی می‌شود.',
  },
  cabTrashNote: {
    en: 'Deleted notes wait here for 30 days.',
    fa: 'نوت‌های حذف‌شده ۳۰ روز اینجا می‌مانند.',
  },
  cabNoMatch: { en: 'Nothing matches that', fa: 'چیزی با آن پیدا نشد' },
  cabNoMatchNote: {
    en: 'Try fewer words, or clear the search.',
    fa: 'کلمات کمتری بنویس، یا جست‌وجو را پاک کن.',
  },
  cabNameThis: { en: 'Name this note', fa: 'برای این نوت اسم بگذار' },
  cabCouldNotRename: { en: 'Could not rename', fa: 'تغییر نام نشد' },
  cabNoteMayBeGone: { en: 'The note may have been deleted.', fa: 'شاید نوت حذف شده باشد.' },
  cabCouldNotRestore: { en: 'Could not restore', fa: 'بازگرداندن نشد' },
  cabVersionGone: {
    en: 'That version is no longer in the database.',
    fa: 'آن نسخه دیگر در پایگاه داده نیست.',
  },
  cabExportWhat: { en: 'What to export:', fa: 'چه چیزی خروجی بگیرم:' },
  cabExportZip: {
    en: 'Everything: text, positions, colours, drawings and images. The only one that can be imported back into this extension. Keep this one.',
    fa: 'همه چیز: متن، مکان، رنگ، نقاشی و عکس. تنها فرمتی که می‌شود دوباره به همین افزونه برگرداند. همین را نگه دار.',
  },
  cabExportMd: {
    en: 'One .md file, grouped by page. Opens in any editor. Loses positions, colours and drawings.',
    fa: 'یک فایل md، گروه‌بندی‌شده بر اساس صفحه. در هر ادیتوری باز می‌شود. مکان و رنگ و نقاشی را از دست می‌دهد.',
  },
  cabExportHtml: {
    en: 'One file that opens in any browser, with the images inside it and nothing fetched from the internet. Good for reading and printing.',
    fa: 'یک فایل که در هر مرورگری باز می‌شود، عکس‌ها داخل خودش، و هیچ چیز از اینترنت نمی‌گیرد. برای خواندن و چاپ خوب است.',
  },
  cabImportArchive: { en: 'Import archive', fa: 'ورود آرشیو' },
  cabImportKeepNewest: { en: 'Keep newest', fa: 'جدیدتر بماند' },
  cabImportArchiveWins: { en: 'Archive wins', fa: 'آرشیو برنده' },
  cabImportCopies: { en: 'Import as copies', fa: 'به‌صورت کپی' },
  cabImported: { en: 'Imported', fa: 'وارد شد' },
  cabImportedProblems: { en: 'Imported, with problems', fa: 'وارد شد، با اشکال' },
  cabImportSettings: {
    en: 'Also restore the settings in this archive, replacing yours.',
    fa: 'تنظیمات داخل این آرشیو هم برگردد و جای تنظیمات فعلی را بگیرد.',
  },
  cabImportNoSettings: { en: 'This archive carries no settings.', fa: 'این آرشیو تنظیماتی ندارد.' },
  cabSettingsRestored: { en: 'Settings restored.', fa: 'تنظیمات برگردانده شد.' },
  cabHistoryOff: {
    en: 'Version history is switched off in Settings → Keeping, so nothing is being kept.',
    fa: 'تاریخچهٔ نسخه‌ها در تنظیمات ← نگه‌داری خاموش است، پس چیزی نگه داشته نمی‌شود.',
  },

  // counts and the theme button, which are composed rather than literal
  cabCountNotes: { en: '$1 notes', fa: '$1 نوت' },
  cabCountSites: { en: '$1 sites', fa: '$1 سایت' },
  cabCountTrashed: { en: '$1 in trash', fa: '$1 در سطل' },
  cabCountSelected: { en: '$1 selected', fa: '$1 انتخاب‌شده' },
  cabTrashCount: { en: 'Trash ($1)', fa: 'سطل زباله ($1)' },
  cabNotesHere: { en: '$1 notes', fa: '$1 نوت' },
  cabOneNoteHere: { en: '1 note', fa: '1 نوت' },
  cabJustNow: { en: 'just now', fa: 'همین حالا' },
  cabMinsAgo: { en: '$1m ago', fa: '$1 دقیقه پیش' },
  cabHoursAgo: { en: '$1h ago', fa: '$1 ساعت پیش' },
  cabThemeLabel: { en: 'Colour theme: $1', fa: 'تم رنگی: $1' },
  themeAuto: { en: '◐ Auto', fa: '◐ خودکار' },
  themeDark: { en: '● Dark', fa: '● تاریک' },
  themeLight: { en: '○ Light', fa: '○ روشن' },
  themeAutoTitle: {
    en: 'Colours follow your browser. Click for dark.',
    fa: 'رنگ‌ها از مرورگر پیروی می‌کنند. برای تاریک کلیک کن.',
  },
  themeDarkTitle: {
    en: 'Dark, whatever your browser says. Click for light.',
    fa: 'تاریک، هرچه مرورگر بگوید. برای روشن کلیک کن.',
  },
  themeLightTitle: {
    en: 'Light, whatever your browser says. Click to follow your browser.',
    fa: 'روشن، هرچه مرورگر بگوید. کلیک کن تا از مرورگر پیروی کند.',
  },

  // the settings pane: where, closing, look
  setShowUndecided: {
    en: 'Show notes on a site I have not decided about',
    fa: 'روی سایتی که دربارهٔ آن تصمیم نگرفته‌ام نوت‌ها را نشان بده',
  },
  setShowUndecidedNote: {
    en: 'Off means a site stays clean until you turn notes on for it from the toolbar button.',
    fa: 'خاموش یعنی سایت دست‌نخورده می‌ماند تا از دکمهٔ نوار ابزار نوت‌ها را برایش روشن کنی.',
  },
  setKeepPrivate: {
    en: 'Keep notes made in private windows',
    fa: 'نوت‌های ساخته‌شده در پنجرهٔ ناشناس را نگه دار',
  },
  setKeepPrivateOn: {
    en: 'They are written to the database like any other note.',
    fa: 'مثل هر نوت دیگری در پایگاه داده نوشته می‌شوند.',
  },
  setKeepPrivateOff: {
    en: 'They live in memory only and are gone when the last private window closes.',
    fa: 'فقط در حافظه می‌مانند و با بسته شدن آخرین پنجرهٔ ناشناس از بین می‌روند.',
  },
  setNoSiteRules: { en: 'No per-site decisions yet.', fa: 'هنوز برای هیچ سایتی تصمیمی نگرفته‌ای.' },
  setForget: { en: 'Forget', fa: 'فراموش کن' },
  setNotesOn: { en: 'notes on', fa: 'نوت‌ها روشن' },
  setNotesOff: { en: 'notes off', fa: 'نوت‌ها خاموش' },
  setDecidedSites: {
    en: 'Sites you have decided about ($1)',
    fa: 'سایت‌هایی که تصمیمشان را گرفته‌ای ($1)',
  },
  setWarnClosing: { en: 'Warn before closing a tab', fa: 'قبل از بستن تب هشدار بده' },
  setNever: { en: 'Never', fa: 'هیچ‌وقت' },
  setUnsavedEdits: { en: 'Unsaved edits', fa: 'ویرایش ذخیره‌نشده' },
  setAnyNotes: { en: 'Any notes', fa: 'هر نوتی' },
  setWarnClosingNote: {
    en: 'Firefox decides whether to actually show the dialog, and a page you have not interacted with may get none. Your notes are written to the database long before this could matter, so treat it as a courtesy rather than a safety net.',
    fa: 'اینکه آن پنجره واقعاً نشان داده شود تصمیم فایرفاکس است، و صفحه‌ای که با آن کاری نکرده‌ای ممکن است هیچ هشداری نگیرد. نوت‌هایت مدت‌ها قبل از اینکه این موضوع مهم شود در پایگاه داده نوشته شده‌اند، پس این را یک ادب بدان، نه یک تور نجات.',
  },
  setTabsWatched: { en: 'Tabs watched at once', fa: 'چند تب هم‌زمان زیر نظر باشند' },
  setTabsWatchedNote: {
    en: 'Closing a window full of annotated tabs must not ask you ten times over. The most recently edited tabs get the slots.',
    fa: 'بستن پنجره‌ای پر از تب‌های نوت‌دار نباید ده بار از تو بپرسد. جاها به تب‌هایی می‌رسد که تازه‌تر ویرایش شده‌اند.',
  },
  setTabs: { en: 'tabs', fa: 'تب' },
  setThisApp: { en: 'This app', fa: 'خودِ برنامه' },
  setColours: { en: 'Colours', fa: 'رنگ‌ها' },
  setFollowBrowser: { en: 'Follow the browser', fa: 'پیروی از مرورگر' },
  setDark: { en: 'Dark', fa: 'تاریک' },
  setLight: { en: 'Light', fa: 'روشن' },
  setColoursNote: {
    en: 'The cabinet, the popup and this page. Notes keep their own paper colour — a sticky note that went dark because your system did would be a different note. There is a shortcut for this at the bottom of the cabinet.',
    fa: 'کابینت، پاپ‌آپ و همین صفحه. نوت‌ها رنگ کاغذ خودشان را نگه می‌دارند — استیکی‌نوتی که چون سیستم تاریک شده تاریک شود، نوت دیگری است. یک کلید میان‌بر برای این کار پایین کابینت هست.',
  },
  setMovement: { en: 'Movement', fa: 'حرکت' },
  setFollowSystem: { en: 'Follow the system', fa: 'پیروی از سیستم' },
  setFull: { en: 'Full', fa: 'کامل' },
  setMovementNote: {
    en: 'How much the paper tilts, swings and lags as you drag it. Following the system respects "reduce motion" in your accessibility settings. This is a ceiling: a note set to less movement of its own accord keeps it.',
    fa: 'کاغذ وقتی می‌کشی‌اش چقدر کج شود، تاب بخورد و عقب بماند. پیروی از سیستم به «کاهش حرکت» در تنظیمات دسترس‌پذیری‌ات احترام می‌گذارد. این یک سقف است: نوتی که خودش حرکت کمتری انتخاب کرده، همان را نگه می‌دارد.',
  },
  setNewNoteLooks: { en: 'How a new note looks', fa: 'نوت تازه چه شکلی باشد' },
  setNewNoteLooksNote: {
    en: 'Any note can still be changed on its own — press S on a note, or use the sliders button in its header — and a note keeps whatever it changed even when you alter the defaults here.',
    fa: 'هر نوتی را می‌شود جداگانه عوض کرد — روی نوت کلید S را بزن، یا از دکمهٔ لغزنده‌ها در سرش استفاده کن — و نوت هر چیزی را که خودش عوض کرده نگه می‌دارد، حتی وقتی این پیش‌فرض‌ها را تغییر دهی.',
  },
  setTypeNote: {
    en: 'Six of these are bundled with the extension and load only when a note uses one, so they look the same on every machine. The two System entries use whatever your computer has.',
    fa: 'شش تای این‌ها همراه افزونه می‌آیند و فقط وقتی نوتی از آن‌ها استفاده کند بارگذاری می‌شوند، پس روی هر دستگاهی یک شکل‌اند. دو گزینهٔ System از هر چیزی که کامپیوترت دارد استفاده می‌کنند.',
  },
  setTextSize: { en: 'Text size', fa: 'اندازهٔ متن' },
  setTextSizeNote: {
    en: 'The same range a single note offers, so a default can never be a size a note could not be.',
    fa: 'همان بازه‌ای که یک نوت به‌تنهایی می‌دهد، پس پیش‌فرض هرگز اندازه‌ای نمی‌شود که نوت نتواند باشد.',
  },
  setAutomatic: { en: 'Automatic', fa: 'خودکار' },
  setRtl: { en: 'Right to left', fa: 'راست به چپ' },
  setLtr: { en: 'Left to right', fa: 'چپ به راست' },
  setDirectionNote: {
    en: 'Automatic lets each paragraph decide for itself, so Persian and English can share a note.',
    fa: 'خودکار می‌گذارد هر بند خودش تصمیم بگیرد، پس فارسی و انگلیسی می‌توانند در یک نوت کنار هم باشند.',
  },
  setTornEdgesNote: { en: 'Zero gives a clean rectangle.', fa: 'صفر یک مستطیل تمیز می‌دهد.' },
  setOneStrip: { en: 'One strip', fa: 'یک تکه' },
  setTwoStrips: { en: 'Two strips', fa: 'دو تکه' },
  setHard: { en: 'Hard', fa: 'سخت' },
  setSoft: { en: 'Soft', fa: 'نرم' },

  // the settings pane: keeping, backup, section titles
  setTabWhere: { en: 'Where', fa: 'کجا' },
  setTabClosing: { en: 'Closing', fa: 'بستن' },
  setTabLook: { en: 'Look', fa: 'ظاهر' },
  setTabKeeping: { en: 'Keeping', fa: 'نگه‌داری' },
  setTabBackup: { en: 'Backup', fa: 'بکاپ' },
  setTabKeys: { en: 'Keys', fa: 'کلیدها' },
  setTitleWhere: { en: 'Where notes appear', fa: 'نوت‌ها کجا ظاهر می‌شوند' },
  setTitleClosing: { en: 'Closing a tab', fa: 'بستن یک تب' },
  setTitleLook: { en: 'Appearance', fa: 'ظاهر' },
  setTitleKeeping: { en: 'Keeping and deleting', fa: 'نگه‌داری و حذف' },
  setTitleBackup: { en: 'Backup and language', fa: 'بکاپ و زبان' },
  setTitleKeys: { en: 'Keyboard', fa: 'صفحه‌کلید' },
  setAutoDelete: {
    en: 'Let old notes be deleted automatically',
    fa: 'بگذار نوت‌های قدیمی خودکار حذف شوند',
  },
  setAutoDeleteOff: {
    en: 'Off, so nothing is ever destroyed unless you empty the trash yourself. The trash simply grows, which costs almost nothing.',
    fa: 'خاموش است، پس تا خودت سطل را خالی نکنی چیزی از بین نمی‌رود. سطل فقط بزرگ می‌شود، که هزینه‌اش تقریباً هیچ است.',
  },
  setAutoDeleteOn: {
    en: 'Trashed notes are destroyed once their time is up. The sweep runs four times a day, and a trashed note carrying no deletion date is never destroyed.',
    fa: 'نوت‌های داخل سطل وقتی وقتشان تمام شود از بین می‌روند. جاروکشی روزی چهار بار اجرا می‌شود، و نوتی را که نتواند تاریخ‌گذاری کند حذف نمی‌کند.',
  },
  setKeepTrashedFor: { en: 'Keep trashed notes for', fa: 'نوت‌های سطل را چند وقت نگه دار' },
  setDays: { en: 'days', fa: 'روز' },
  setKeepTrashedNote: {
    en: 'Counted from the day a note went into the trash, and it keeps the whole of its last day. Does nothing while the switch above is off.',
    fa: 'از روزی که نوت به سطل رفته شمرده می‌شود، و تمام روز آخرش را نگه می‌دارد. تا کلید بالا خاموش است کاری نمی‌کند.',
  },
  setVersionHistory: { en: 'Version history', fa: 'تاریخچهٔ نسخه‌ها' },
  setVersionsPerNote: {
    en: 'Earlier versions kept per note',
    fa: 'چند نسخهٔ قبلی برای هر نوت نگه داشته شود',
  },
  setVersions: { en: 'versions', fa: 'نسخه' },
  setVersionsZero: {
    en: 'Zero, so nothing is kept and the History button will have nothing to show. Undo in a page still works; it just does not survive closing the tab.',
    fa: 'صفر، پس چیزی نگه داشته نمی‌شود و دکمهٔ تاریخچه چیزی برای نشان دادن ندارد. undo داخل صفحه هنوز کار می‌کند؛ فقط از بستن تب جان سالم نمی‌برد.',
  },
  setVersionsSome: {
    en: 'Select one note in the cabinet and press History to read them, or put one back. A version is kept when an edit is more than thirty seconds after the last one, or changes the length by a couple of hundred characters — not on every keystroke, or the list would be unreadable. The oldest are dropped past this number.',
    fa: 'در کابینت یک نوت را انتخاب کن و تاریخچه را بزن تا بخوانی‌شان، یا یکی را برگردانی. نسخه وقتی نگه داشته می‌شود که ویرایش بیش از سی ثانیه بعد از ویرایش قبلی باشد، یا طول متن را چند صد کاراکتر عوض کند — نه با هر کلید، وگرنه فهرست خواندنی نمی‌شد. قدیمی‌ترها بعد از این عدد کنار گذاشته می‌شوند.',
  },
  setExportNote: {
    en: 'Export… in the bar above works now and needs no permission at all. It contains every note, its position, its style and its images, as one archive you can keep anywhere.',
    fa: '«خروجی…» در نوار بالا همین حالا کار می‌کند و هیچ مجوزی نمی‌خواهد. همهٔ نوت‌ها، مکان، استایل و عکس‌هایشان را در یک آرشیو دارد که هرجا بخواهی نگه می‌داری.',
  },
  setAutomatically: { en: 'Automatically', fa: 'خودکار' },
  setSaveAuto: { en: 'Save a backup automatically', fa: 'خودکار یک بکاپ ذخیره کن' },
  setHowOften: { en: 'How often', fa: 'هر چند وقت' },
  setBackupNow: { en: 'Back up now', fa: 'همین حالا بکاپ بگیر' },
  setRunOneNow: { en: 'Run one now', fa: 'یکی را همین حالا اجرا کن' },
  setWorking: { en: 'Working…', fa: 'در حال کار…' },
  setNeverRun: { en: 'It has never run.', fa: 'هیچ‌وقت اجرا نشده.' },
  setItFailed: { en: 'It failed.', fa: 'شکست خورد.' },
  setNothingToBackUp: { en: 'Nothing to back up.', fa: 'چیزی برای بکاپ نیست.' },
  setNoAnswer: { en: 'The background did not answer.', fa: 'پس‌زمینه جواب نداد.' },
  setDownloadsGone: {
    en: 'Firefox has withdrawn permission to save files, so this cannot run. Switch it off and on again to ask for it back.',
    fa: 'فایرفاکس مجوز ذخیرهٔ فایل را پس گرفته، پس این نمی‌تواند اجرا شود. خاموش و روشنش کن تا دوباره درخواست شود.',
  },
  setLanguage: { en: 'Language', fa: 'زبان' },
  setLanguageNote: {
    en: 'The whole interface — the cabinet, the settings, the popup and a note’s own panel. Notes keep whatever you typed in them, in whatever language you typed it.',
    fa: 'تمام رابط کاربری — کابینت، تنظیمات، پاپ‌آپ و پنل خود نوت. نوت‌ها هرچه در آن‌ها نوشته‌ای را به همان زبانی که نوشته‌ای نگه می‌دارند.',
  },
  setCheckDaily: {
    en: 'Check for a new version once a day',
    fa: 'روزی یک بار نسخهٔ جدید را بررسی کن',
  },
  setCheckDailyNote: {
    en: 'The only network request this extension can make. Off unless you turn it on, and it asks permission the first time. No cookies, no referrer, nothing about you — it reads the release list and compares one version number.',
    fa: 'تنها درخواست شبکه‌ای که این افزونه می‌تواند بزند. تا روشنش نکنی خاموش است، و بار اول اجازه می‌گیرد. نه کوکی، نه referrer، هیچ چیزی دربارهٔ تو — فهرست انتشارها را می‌خواند و یک شمارهٔ نسخه را مقایسه می‌کند.',
  },

  // the keyboard reference
  keyOnSelected: { en: 'On a selected note', fa: 'روی نوتِ انتخاب‌شده' },
  keyWhileWriting: { en: 'While writing', fa: 'وقتی می‌نویسی' },
  keyAnywhereNote: { en: 'Anywhere in a note', fa: 'هرجا در یک نوت' },
  keyOnAnyPage: { en: 'On any page', fa: 'روی هر صفحه' },
  keyInFirefox: { en: 'Anywhere in Firefox — rebindable', fa: 'هرجا در فایرفاکس — قابل تغییر' },
  keyOther: { en: 'Other', fa: 'سایر' },
  keyNoteSettings: {
    en: 'This note’s settings — colour, type, size, direction, paper',
    fa: 'تنظیمات این نوت — رنگ، قلم، اندازه، جهت، کاغذ',
  },
  keyNextColour: { en: 'Next colour', fa: 'رنگ بعدی' },
  keyDraw: { en: 'Draw', fa: 'نقاشی' },
  keyPenEraser: { en: 'Pen / eraser', fa: 'قلم / پاک‌کن' },
  keyUndoStroke: { en: 'Undo the last brush stroke', fa: 'برگرداندن آخرین حرکت قلم' },
  keyLock: { en: 'Lock the note', fa: 'قفل کردن نوت' },
  keyCollapse: { en: 'Collapse it', fa: 'جمع کردنش' },
  keyStartWriting: { en: 'Start writing', fa: 'شروع نوشتن' },
  keySendToTrash: { en: 'Send it to the trash', fa: 'انداختنش در سطل' },
  keyNudge: {
    en: 'Nudge it — Shift ×10, Ctrl ×25',
    fa: 'تکان دادنش — Shift ده برابر، Ctrl بیست‌وپنج برابر',
  },
  keyResize: { en: 'Resize it', fa: 'تغییر اندازه' },
  keyLeaveDrawing: { en: 'Leave drawing', fa: 'خروج از نقاشی' },
  keyBold: { en: 'Bold', fa: 'ضخیم' },
  keyItalic: { en: 'Italic', fa: 'کج' },
  keyStrike: { en: 'Strikethrough', fa: 'خط‌خورده' },
  keyCode: { en: 'Code', fa: 'کد' },
  keyLink: { en: 'Make a link', fa: 'ساختن لینک' },
  keyQuote: { en: 'Quote', fa: 'نقل‌قول' },
  keyBullets: { en: 'Bullet list', fa: 'فهرست نقطه‌ای' },
  keyNumbers: { en: 'Numbered list', fa: 'فهرست شماره‌دار' },
  keyTasks: { en: 'Task list', fa: 'فهرست کارها' },
  keyTickTask: { en: 'Tick or untick the task on this line', fa: 'تیک زدن یا برداشتن کارِ این خط' },
  keyHeading: {
    en: 'Heading — again for a smaller one, again for none',
    fa: 'تیتر — دوباره برای کوچک‌تر، دوباره برای هیچ',
  },
  keyInsertDate: { en: 'Insert today’s date', fa: 'درج تاریخ امروز' },
  keyClearFormat: { en: 'Clear formatting', fa: 'پاک کردن قالب‌بندی' },
  keyPaste: { en: 'Paste text, or an image', fa: 'چسباندن متن، یا یک عکس' },
  keyFinishWriting: {
    en: 'Finish writing and select the note itself',
    fa: 'تمام کردن نوشتن و انتخاب خودِ نوت',
  },
  keyUndoAll: {
    en: 'Undo — typing, colour, moving, resizing, drawing, deleting, in order',
    fa: 'برگرداندن — تایپ، رنگ، جابه‌جایی، تغییر اندازه، نقاشی، حذف، به ترتیب',
  },
  keyRedo: {
    en: 'Redo — Ctrl + Shift + Z as well',
    fa: 'انجام دوباره — Ctrl + Shift + Z هم همین کار را می‌کند',
  },
  keyAltDouble: { en: 'Make a note where you clicked', fa: 'ساختن نوت جایی که کلیک کردی' },
  keyRightClick: {
    en: 'Add a note here, or on the selected text',
    fa: 'افزودن نوت اینجا، یا روی متن انتخاب‌شده',
  },
  keyNewNoteMiddle: {
    en: 'Stick a note in the middle of the page',
    fa: 'چسباندن یک نوت وسط صفحه',
  },
  keyToggleTab: {
    en: 'Turn notes off, or back on, for this tab',
    fa: 'خاموش یا روشن کردن نوت‌ها برای این تب',
  },
  keyFocusNext: {
    en: 'Move focus to the next note on the page',
    fa: 'رفتن به نوت بعدی در صفحه',
  },
  keyOpenCabinet: { en: 'Open the cabinet', fa: 'باز کردن کابینت' },
  keyOpenFirefoxShortcuts: {
    en: 'Open Firefox’s shortcut settings',
    fa: 'باز کردن تنظیمات کلیدهای فایرفاکس',
  },
  keyFirefoxOwns: {
    en: 'Firefox keeps these bindings itself, and only Firefox can change them: about:addons → the gear at the top right → Manage Extension Shortcuts. Whatever you set there is what this list shows.',
    fa: 'خودِ فایرفاکس این کلیدها را نگه می‌دارد و فقط خودش می‌تواند عوضشان کند: about:addons ← چرخ‌دنده بالا سمت راست ← Manage Extension Shortcuts. هرچه آنجا تنطیم کنی همان چیزی است که این فهرست نشان می‌دهد.',
  },
  keyCannotOpen: {
    en: 'Firefox will not let an extension open that page. Copy about:addons into the address bar yourself, then use the gear at the top right → Manage Extension Shortcuts.',
    fa: 'فایرفاکس اجازه نمی‌دهد افزونه آن صفحه را باز کند. خودت about:addons را در نوار آدرس بنویس، بعد از چرخ‌دنده بالا سمت راست ← Manage Extension Shortcuts.',
  },
  keySelectedExplain: {
    en: 'Grabbing a note’s header selects the note, which is the state the single-key shortcuts work in. Clicking its text puts you in the editor, where the Ctrl chords apply and every plain key is just a letter. Escape takes you from the text back to the note.',
    fa: 'گرفتنِ سرِ نوت آن را انتخاب می‌کند، و کلیدهای تک‌حرفی در همین حالت کار می‌کنند. کلیک روی متنش تو را در ویرایشگر می‌گذارد، جایی که ترکیب‌های Ctrl کار می‌کنند و هر کلید ساده فقط یک حرف است. Escape تو را از متن به نوت برمی‌گرداند.',
  },
  keyNoCtrlU: {
    en: 'There is no Ctrl+U: markdown has no underline, so there is nothing for it to produce that a note could render. Ctrl+Shift+M and Ctrl+Shift+K are left alone as well — those are Firefox’s own, for responsive design mode and the console.',
    fa: 'کلید Ctrl+U وجود ندارد: markdown خط زیر ندارد، پس چیزی نیست که نوت بتواند نشانش دهد. Ctrl+Shift+M و Ctrl+Shift+K هم دست‌نخورده مانده‌اند — آن‌ها مالِ خود فایرفاکس‌اند، برای حالت طراحی واکنش‌گرا و کنسول.',
  },
  keyUnbound: { en: 'not set', fa: 'تعیین نشده' },

  // the last of the settings pane
  setBackupNotNote: {
    en: 'What this is not: it cannot choose the folder — the browser decides that — it cannot run while Firefox is closed, and a file on the same disk is not an off-site backup. It survives Refresh Firefox and uninstalling the extension. It does not survive the disk failing.',
    fa: 'این چه چیزی نیست: نمی‌تواند پوشه را انتخاب کند — مرورگر تصمیم می‌گیرد — وقتی فایرفاکس بسته است اجرا نمی‌شود، و فایلی روی همان دیسک بکاپ خارج از محل نیست. از Refresh Firefox و حذف افزونه جان سالم می‌برد. از خراب شدن دیسک نه.',
  },
  keyHoldAlt: { en: 'Hold Alt', fa: 'نگه داشتن Alt' },
  keySeeThrough: {
    en: 'See through the notes, and click the page under them',
    fa: 'دیدنِ صفحه از پشت نوت‌ها، و کلیک روی خودِ صفحه',
  },
  keyArrows: { en: 'Arrows', fa: 'کلیدهای جهت' },
  keyAltArrows: { en: 'Alt + arrows', fa: 'Alt + کلیدهای جهت' },
  keyAltDoubleClick: { en: 'Alt + double-click', fa: 'Alt + دوبار کلیک' },
  keyRightClickCap: { en: 'Right-click', fa: 'کلیک راست' },

  // the note itself
} as const satisfies Record<string, Entry>;

export type MessageKey = keyof typeof CATALOGUE;

/** Look up a message. See `i18n-core.ts` for the engine and `i18n-note.ts` for the split. */
export const t = makeT(CATALOGUE);

/**
 * The shape `_locales/<lang>/messages.json` expects. Used by the build.
 *
 * Falls back to English for anything untranslated, which is the same rule `t()` follows -- and
 * it has to, because a missing `message` here is not a gap in a sentence somewhere, it is the
 * add-on's NAME coming out blank in about:addons. Firefox reads these files itself for the
 * manifest's `__MSG_*__` placeholders and has nowhere else to look.
 */
export function toMessagesJson(
  target: Lang,
): Record<string, { message: string; description?: string }> {
  const out: Record<string, { message: string; description?: string }> = {};
  for (const [key, entry] of Object.entries(CATALOGUE) as Array<[string, Entry]>) {
    const message = entry[target] ?? entry.en;
    out[key] = entry.note ? { message, description: entry.note } : { message };
  }
  return out;
}
