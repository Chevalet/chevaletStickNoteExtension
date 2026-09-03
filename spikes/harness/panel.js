/** chevaletNote spike harness -- dashboard. Throwaway. */

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);
const esc = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const verdict = (r) =>
  r
    ? `<span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>` +
      (r.detail ? ` <span class="k">${esc(r.detail)}</span>` : '')
    : '<span class="k">—</span>';

// --------------------------------------------------------------------------- permissions

async function refreshPerms() {
  const all = await browser.permissions.getAll();
  $('perm-state').textContent = `granted origins: ${all.origins.join(', ') || '(none)'}`;
}

$('grant-all').onclick = async () => {
  await send({ t: 'request-hosts', origins: ['*://*/*'] });
  refreshPerms();
};
$('grant-file').onclick = async () => {
  await send({ t: 'request-hosts', origins: ['file:///*'] });
  refreshPerms();
};

// --------------------------------------------------------------------------- R1 guard

const tabIdFrom = (inputId) => {
  const v = Number.parseInt($(inputId).value, 10);
  if (!Number.isFinite(v)) {
    alert('Enter a tab id from the R5a table first.');
    return null;
  }
  return v;
};

$('guard-on').onclick = async () => {
  const id = tabIdFrom('guard-tab');
  if (id !== null) report(await send({ t: 'set-guard', tabId: id, armed: true }));
};
$('guard-off').onclick = async () => {
  const id = tabIdFrom('guard-tab');
  if (id !== null) report(await send({ t: 'set-guard', tabId: id, armed: false }));
};
$('close-api').onclick = async () => {
  const id = tabIdFrom('guard-tab');
  if (id !== null) report(await send({ t: 'close-tab-via-api', tabId: id }));
};

function report(r) {
  if (r && r.ok === false) alert(r.error ?? 'failed');
}

// --------------------------------------------------------------------------- R5a tab map

async function refreshTabs() {
  const { rows } = await send({ t: 'tab-map' });
  const seen = new Map();
  for (const r of rows) if (r.key) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);

  $('tabs-table').innerHTML =
    '<thead><tr><th>id</th><th>win</th><th>#</th><th>flags</th><th>tabKey</th>' +
    '<th>title</th><th>actions</th></tr></thead><tbody>' +
    rows
      .map((r) => {
        const flags = [
          r.discarded ? 'discarded' : '',
          r.incognito ? 'private' : '',
          r.cookieStoreId && r.cookieStoreId !== 'firefox-default' ? r.cookieStoreId : '',
        ]
          .filter(Boolean)
          .join(' ');
        const dup = r.key && seen.get(r.key) > 1;
        const key = r.key
          ? `<span class="${dup ? 'fail' : ''}">${esc(r.key.slice(0, 14))}…${dup ? ' SHARED!' : ''}</span>`
          : '<span class="k">(none)</span>';
        return (
          `<tr><td>${r.id}</td><td>${r.windowId}</td><td>${r.index}</td>` +
          `<td class="k">${esc(flags)}</td><td class="k">${key}</td>` +
          `<td class="k">${esc(r.title)}<br>${esc(r.url)}</td>` +
          `<td><button class="sm" data-use="${r.id}">use</button></td></tr>`
        );
      })
      .join('') +
    '</tbody>';

  for (const b of $('tabs-table').querySelectorAll('[data-use]')) {
    b.onclick = () => {
      $('guard-tab').value = b.dataset.use;
      $('probe-tab').value = b.dataset.use;
    };
  }
}

$('refresh-tabs').onclick = refreshTabs;
$('time-keys').onclick = async () => {
  const r = await send({ t: 'time-getTabValue' });
  $('key-timing').textContent = `${r.tabs} tabs in ${r.ms} ms (${(r.ms / r.tabs).toFixed(2)} ms/tab)`;
};

// --------------------------------------------------------------------------- recovery

async function refreshClosed() {
  const { rows } = await send({ t: 'recently-closed' });
  $('closed-table').innerHTML =
    '<thead><tr><th>kind</th><th>title / url</th><th>actions</th></tr></thead><tbody>' +
    rows
      .map(
        (r, i) =>
          `<tr><td>${r.kind}</td><td class="k">${esc(r.title)}<br>${esc(r.url)}</td>` +
          `<td><button class="sm" data-restore="${esc(r.sessionId)}">restore</button>` +
          (r.url ? `<button class="sm ghost" data-reopen="${i}">reopen + reattach</button>` : '') +
          '</td></tr>',
      )
      .join('') +
    '</tbody>';

  for (const b of $('closed-table').querySelectorAll('[data-restore]')) {
    b.onclick = async () => {
      const r = await send({ t: 'restore-session', sessionId: b.dataset.restore });
      alert(`restored tab ${r.tabId}\nkey came back: ${r.key ?? '(none)'}`);
      refreshTabs();
    };
  }
  for (const b of $('closed-table').querySelectorAll('[data-reopen]')) {
    b.onclick = async () => {
      const row = rows[Number(b.dataset.reopen)];
      const key = prompt('tabKey to reattach (paste a full tk_… from the log)', 'tk_');
      if (!key) return;
      const r = await send({ t: 'reopen-and-reattach', url: row.url, key });
      alert(`tab ${r.tabId}\nkey now reads back as: ${r.key ?? '(none)'}`);
      refreshTabs();
    };
  }
}

$('refresh-closed').onclick = refreshClosed;

// --------------------------------------------------------------------------- R2 + R6

const R2_ROWS = [
  ['fetchExtensionBytes', 'fetch(runtime.getURL) → bytes'],
  ['adoptedStyleSheets', 'adoptedStyleSheets in closed shadow'],
  ['shadowStyleTag', '<style> in closed shadow'],
  ['fontFaceConstruct', 'new FontFace(name, ArrayBuffer)'],
  ['fontFaceAdd', 'document.fonts.add() cross-compartment'],
  ['fontFaceLoad', 'face.load() — CSP vs parse error'],
  ['fontFaceViaWindow', 'FontFace via window ctor (fallback)'],
  ['imgMozExtension', '<img src=moz-extension://> (avoided)'],
  ['imageBitmapToCanvas', 'bytes → ImageBitmap → canvas'],
];
const R6_ROWS = [
  ['hostPresent', 'host attached'],
  ['hostIsLastChild', 'host is last child of <html>'],
  ['hostSurvives1500ms', 'host survives 1.5 s'],
  ['passThrough', 'uncovered pixel hits the PAGE'],
  ['noteHittable', 'covered pixel hits the note'],
  ['styleIsolated', 'page CSS does not bleed in'],
  ['fixedIsSafe', 'position:fixed is viewport-relative'],
];

async function refreshResults() {
  const { results } = await send({ t: 'get-store' });
  const origins = Object.keys(results).sort();
  if (!origins.length) {
    $('results-table').innerHTML = '<tbody><tr><td class="k">No probes run yet.</td></tr></tbody>';
    return;
  }
  const head = `<thead><tr><th>check</th>${origins
    .map((o) => `<th>${esc(o.replace(/^https?:\/\//, ''))}</th>`)
    .join('')}</tr></thead>`;

  const section = (label, rows, group) =>
    `<tr><th colspan="${origins.length + 1}">${label}</th></tr>` +
    rows
      .map(
        ([k, name]) =>
          `<tr><td>${esc(name)}</td>${origins
            .map((o) => `<td>${verdict(results[o]?.[group]?.[k])}</td>`)
            .join('')}</tr>`,
      )
      .join('');

  const envRow = (k, label) =>
    `<tr><td>${esc(label)}</td>${origins
      .map((o) => `<td class="k">${esc(results[o]?.env?.[k] ?? '—')}</td>`)
      .join('')}</tr>`;

  $('results-table').innerHTML =
    head +
    '<tbody>' +
    section('R2 — CSP-immune asset delivery', R2_ROWS, 'r2') +
    section('R6 — host survival', R6_ROWS, 'r6') +
    `<tr><th colspan="${origins.length + 1}">environment</th></tr>` +
    envRow('plaintextOnly', 'contenteditable=plaintext-only') +
    envRow('selectionChangeLeaks', 'selectionchange events leaked') +
    envRow('docDir', 'document direction') +
    envRow('csp', 'CSP meta tag') +
    '</tbody>';
}

$('inject-probe').onclick = async () => {
  const id = tabIdFrom('probe-tab');
  if (id === null) return;
  const r = await send({ t: 'inject-probe', tabId: id });
  if (!r.ok) return alert(r.error);
  setTimeout(refreshResults, 2500);
};
$('refresh-results').onclick = refreshResults;
$('clear-store').onclick = async () => {
  if (!confirm('Clear all probe results and the event log?')) return;
  await send({ t: 'clear-store' });
  refreshResults();
  refreshLog();
};

// --------------------------------------------------------------------------- R5b IDB bench

const BENCH_DB = 'cn-spike-bench';

function openBench() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BENCH_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const notes = db.createObjectStore('notes', { keyPath: 'id' });
      // The plan's schema: state is folded into the multiEntry key because IDB forbids a
      // compound index over a multiEntry component. R5b proves that constraint is real.
      notes.createIndex('by_state_url', 'ix_urlKeys', { multiEntry: true });
      notes.createIndex('by_state_origin', ['ix_state', 'ix_origin']);
      notes.createIndex('by_state_domain', ['ix_state', 'ix_domain']);
      notes.createIndex('by_state_tab', ['ix_state', 'ix_tabKey']);
      notes.createIndex('by_updated', 'updatedAt');
      notes.createIndex('by_tag', 'tags', { multiEntry: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx) =>
  new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });

const req = (r) =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

function makeNote(i) {
  const domain = `site${i % 500}.com`;
  const origin = `https://${domain}`;
  const urlKey = `//${domain}/page/${i % 4000}`;
  return {
    id: `n_${i}`,
    schemaV: 1,
    rev: 1,
    ix_state: 'active',
    ix_urlKeys: [`active ${urlKey}`],
    ix_origin: origin,
    ix_domain: domain,
    ix_tabKey: `tk_${i % 300}`,
    body: { format: 'md', text: `note ${i} — ${'lorem ipsum dolor sit amet '.repeat(70)}` },
    title: `note ${i}`,
    tags: [`t${i % 40}`],
    ui: { x: i % 1200, y: i % 3000, w: 260, h: 180, z: 1, collapsed: false, locked: false, opacity: 1 },
    createdAt: Date.now() - i * 1000,
    updatedAt: Date.now() - i * 500,
  };
}

const ms = (t0) => +(performance.now() - t0).toFixed(2);

$('run-bench').onclick = async () => {
  const out = $('bench-out');
  const total = Math.max(1, Number.parseInt($('seed-count').value, 10) || 10000);
  const rows = [];
  const put = (k, v) => {
    rows.push([k, v]);
    out.innerHTML = rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('');
  };

  put('status', 'opening…');
  let t0 = performance.now();
  const db = await openBench();
  put('indexedDB.open (warm)', `${ms(t0)} ms`);

  // Does the spec restriction the schema works around actually bite here?
  try {
    const probe = indexedDB.open(`${BENCH_DB}-probe`, 1);
    probe.onupgradeneeded = () => {
      probe.result
        .createObjectStore('x', { keyPath: 'id' })
        .createIndex('bad', ['a', 'b'], { multiEntry: true });
    };
    await new Promise((res) => {
      probe.onsuccess = () => {
        probe.result.close();
        indexedDB.deleteDatabase(`${BENCH_DB}-probe`);
        put('compound + multiEntry index', 'ALLOWED — schema workaround may be unnecessary');
        res();
      };
      probe.onerror = () => {
        put('compound + multiEntry index', `rejected (${probe.error?.name}) — workaround needed`);
        res();
      };
    });
  } catch (e) {
    put('compound + multiEntry index', `throws ${e.name} — workaround needed (as planned)`);
  }

  const existing = await new Promise((res) => {
    const r = db.transaction('notes').objectStore('notes').count();
    r.onsuccess = () => res(r.result);
  });

  if (existing < total) {
    put('status', `seeding ${total - existing}…`);
    t0 = performance.now();
    const CHUNK = 2000;
    for (let i = existing; i < total; i += CHUNK) {
      const tx = db.transaction('notes', 'readwrite');
      const os = tx.objectStore('notes');
      for (let j = i; j < Math.min(i + CHUNK, total); j++) os.put(makeNote(j));
      await done(tx);
    }
    put(`seed ${total - existing} notes`, `${ms(t0)} ms`);
  } else {
    put('seed', `already ${existing} notes`);
  }

  // The hot path: what runs on every page load in every tab.
  const HOT_RUNS = 200;
  const times = [];
  for (let r = 0; r < HOT_RUNS; r++) {
    const i = (r * 977) % 4000;
    const domain = `site${i % 500}.com`;
    t0 = performance.now();
    const tx = db.transaction('notes');
    const os = tx.objectStore('notes');
    await Promise.all(
      [
        req(os.index('by_state_url').getAll(`active //${domain}/page/${i}`)),
        req(os.index('by_state_origin').getAll(['active', `https://${domain}`])),
        req(os.index('by_state_domain').getAll(['active', domain])),
        req(os.index('by_state_tab').getAll(['active', `tk_${i % 300}`])),
      ],
    );
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.floor(times.length * q)].toFixed(2);
  put('hot query p50 / p95 / p99', `${p(0.5)} / ${p(0.95)} / ${p(0.99)} ms`);
  put('GATE: p95 < 5 ms', Number(p(0.95)) < 5 ? 'PASS' : 'FAIL — schema needs rework');

  t0 = performance.now();
  const tx2 = db.transaction('notes', 'readwrite');
  for (let i = 0; i < 20; i++) tx2.objectStore('notes').put(makeNote(1_000_000 + i));
  await done(tx2);
  put('batched write, 20 records', `${ms(t0)} ms`);

  t0 = performance.now();
  await req(db.transaction('notes').objectStore('notes').index('by_state_tab').getAll(['active', 'tk_7']));
  put('getAll one tabKey', `${ms(t0)} ms`);

  t0 = performance.now();
  const all = await req(db.transaction('notes').objectStore('notes').getAll());
  put('full getAll (what storage.local would force)', `${ms(t0)} ms for ${all.length} records`);

  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    put('origin usage', `${(e.usage / 1048576).toFixed(1)} MB of ${(e.quota / 1048576).toFixed(0)} MB`);
  }
  if (navigator.storage?.persisted) {
    put('storage persisted', String(await navigator.storage.persisted()));
  }

  try {
    db.transaction('notes', 'readwrite', { durability: 'strict' }).abort();
    put('durability:"strict"', 'supported');
  } catch (e) {
    put('durability:"strict"', `not supported (${e.name})`);
  }

  db.close();
  put('status', 'done');
};

$('drop-db').onclick = async () => {
  indexedDB.deleteDatabase(BENCH_DB);
  $('bench-out').innerHTML = '<dt>status</dt><dd>dropped</dd>';
};

// --------------------------------------------------------------------------- log

let lastLog = [];

async function refreshLog() {
  const { log } = await send({ t: 'get-store' });
  lastLog = log;
  $('log-out').textContent = log
    .slice(-220)
    .map((e) => {
      const { t, event, ...rest } = e;
      return `${new Date(t).toISOString().slice(11, 23)}  ${event.padEnd(24)} ${JSON.stringify(rest)}`;
    })
    .join('\n');
}

$('refresh-log').onclick = refreshLog;
$('copy-log').onclick = () => navigator.clipboard.writeText(JSON.stringify(lastLog, null, 2));

// ---------------------------------------------------------------------------

refreshPerms();
refreshTabs();
refreshClosed();
refreshResults();
refreshLog();
