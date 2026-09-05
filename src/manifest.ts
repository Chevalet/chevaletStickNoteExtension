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

    // AMO shows both of these on the listing page, and a listing with neither reads as
    // abandoned before anyone has installed it.
    author: 'Atur Dana',
    homepage_url: 'https://github.com/Chevalet/chevaletStickNoteExtension',

    browser_specific_settings: {
      gecko: {
        id: 'chevalet-note@chevalet.dev',
        /**
         * 140 desktop, 142 Android, because of `data_collection_permissions` below.
         *
         * The floor was 128 (which is what `scripting` with `world: "MAIN"` needs, the fallback
         * path for the close guard). AMO's validator warned about it, correctly: the key that
         * declares we collect nothing did not exist until Firefox 140, and until 142 on Android,
         * so claiming 128 promised support we could not deliver on old builds.
         *
         * Raising the floor is the right way to resolve that rather than dropping the
         * declaration. "This add-on collects no data", stated in the manifest where the browser
         * itself can show it, is the single strongest line in the listing, and Firefox 140 is
         * old enough that nobody is stranded.
         */
        strict_min_version: '140.0',
        strict_min_version_android: '142.0',
        // Nothing leaves the machine except the update check, which is off by default and asks
        // first. Declaring it explicitly is what lets Firefox show "collects no data".
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
        24: 'assets/icon-24.png',
        32: 'assets/icon-32.png',
        48: 'assets/icon-48.png',
      },
    },

    /**
     * One logo, every size, rasterised from `assets/logo.svg` by `spikes/make-icons.mjs`.
     *
     * There used to be a second simplified file for small sizes. A single identity was asked
     * for, so the logo itself was redrawn to fill 92% of its frame with nothing thinner than
     * 3 of 64 units, which is what makes it read at 16px without a separate drawing. Run the
     * script and commit the PNGs whenever the SVG changes; the two must not drift apart.
     */
    icons: {
      16: 'assets/icon-16.png',
      32: 'assets/icon-32.png',
      48: 'assets/icon-48.png',
      64: 'assets/icon-64.png',
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
      'alarms', // the daily update check, when it is turned on
      'menus', // "Add a note here" context menu
      'activeTab', // lets the toolbar button work before any host permission is granted
    ],

    /**
     * Kept optional so the install prompt stays quiet, and requested from a click, in context.
     *
     * Empty on purpose. `downloads` and `webNavigation` were declared here for features that
     * were designed and never built: unattended scheduled backup, and finer SPA navigation
     * detection. An extension that asks for a permission it never uses is asking a reviewer to
     * take its word for something untrue -- and a user to grant something for nothing. They go
     * back on the day the code that needs them lands. Manual export needs no permission at all,
     * and `tabs.onUpdated` already covers navigation.
     */
    /*
     * Asked for at the switch that needs it, never at install.
     *
     * `downloads` is only used by the scheduled backup. Putting "Download files" on the
     * install prompt of a notes extension, for a feature most people will never turn on, is
     * how an add-on gets refused before it is tried -- so it is requested from the click in
     * the settings pane, and the switch does not move if the request is declined.
     */
    optional_permissions: ['downloads'],

    host_permissions: [],
    optional_host_permissions: [
      '*://*/*',
      'file:///*',
      // Only for the update check, only when the button is pressed. Nothing else in the
      // extension makes a network request of any kind.
      'https://api.github.com/*',
    ],

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
