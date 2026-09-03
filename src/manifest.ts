/**
 * Manifest generator. See plan sections 1, 4 (injection) and 12 (AMO compliance).
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  1. `host_permissions` is EMPTY on purpose. Firefox MV3 does not grant host permissions at
 *     install time, so declaring them buys nothing but a scary install prompt. We ask for
 *     them from a click in the popup via `permissions.request()`, offering this-site /
 *     this-domain / all-sites.
 *
 *  2. There are NO static `content_scripts`. Every injection is registered dynamically per
 *     origin-that-has-notes (`scripting.registerContentScripts`, persistAcrossSessions), so a
 *     site with no notes receives zero bytes.
 */

export interface ManifestInput {
  version: string;
}

export function manifest({ version }: ManifestInput): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version,
    default_locale: 'en',

    browser_specific_settings: {
      gecko: {
        id: 'chevalet-note@chevalet.dev',
        // 128 is the floor for scripting `world: "MAIN"`, which is the fallback path for the
        // close guard if spike R1 shows isolated-world beforeunload cancellation is ignored.
        strict_min_version: '128.0',
        // Nothing leaves the machine. No telemetry, no analytics, no network requests at all.
        // Declaring this explicitly is both an AMO requirement-in-waiting and the strongest
        // line in the store listing.
        data_collection_permissions: { required: ['none'] },
      },
    },

    // Firefox has no background.service_worker. An event page is the only correct MV3
    // background on Gecko. It is non-persistent: every listener must be registered at module
    // top level, synchronously, or events are dropped.
    background: {
      scripts: ['bg/main.js'],
      type: 'module',
    },

    action: {
      default_popup: 'ui/popup.html',
      default_title: '__MSG_extName__',
      default_icon: {
        16: 'assets/icon-16.png',
        32: 'assets/icon-32.png',
        48: 'assets/icon-48.png',
      },
    },

    icons: {
      48: 'assets/icon-48.png',
      96: 'assets/icon-96.png',
      128: 'assets/icon-128.png',
    },

    options_ui: {
      page: 'ui/options.html',
      open_in_tab: true,
    },

    permissions: [
      'storage', // settings in storage.local, tab maps in storage.session
      'unlimitedStorage', // marks the QuotaManager group persistent -- notes are never evicted
      'sessions', // setTabValue: per-tab state that survives session restore
      'tabs', // tab urls/titles for scope matching and the manager
      'scripting', // dynamic registration + on-demand injection
      'alarms', // GC sweep, scheduled backup
      'menus', // "Add a note here" context menu
      'activeTab', // lets the toolbar button work before any host permission is granted
    ],

    // Kept optional so the install prompt stays quiet. Requested from a click, in context.
    optional_permissions: [
      'downloads', // only for UNATTENDED scheduled backup; manual export needs no permission
      'webNavigation', // nicer SPA detection; tabs.onUpdated is the baseline fallback
    ],

    host_permissions: [],
    optional_host_permissions: ['*://*/*', 'file:///*'],

    commands: {
      'new-note': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: '__MSG_cmdNewNote__',
      },
      'toggle-tab': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_cmdToggleTab__',
      },
      'cycle-notes': {
        suggested_key: { default: 'Alt+Shift+K' },
        description: '__MSG_cmdCycleNotes__',
      },
      'open-manager': {
        description: '__MSG_cmdOpenManager__',
      },
    },

    web_accessible_resources: [
      {
        // Fonts are fetched by the content script and installed via `new FontFace(buffer)`,
        // so they are never referenced by URL from the page -- but the fetch still needs the
        // resource to be web-accessible.
        resources: ['assets/fonts/*'],
        matches: ['*://*/*'],
      },
    ],

    incognito: 'spanning',
  };
}
