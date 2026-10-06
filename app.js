/* Calorie Logbook.
   The log lives on this device (IndexedDB) and, once connected, in a private GitHub repository as
   one CSV file per month. Nothing here needs a server of its own. */
(() => {
'use strict';
const VERSION = '1.1.0';
/* The page holds an access token, so it runs only as a page of its own, never inside another site's frame. */
if (window.top !== window.self) { document.body.textContent = 'Open the Calorie Logbook in its own tab.'; return; }

/* ------------------------------------------------------------------ helpers */
const $ = (s, r) => (r || document).querySelector(s);
const h = (tag, props, ...kids) => {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.style.cssText = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const fmt = n => Math.round(n).toLocaleString('en-US');
const pad = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseD = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const today = () => dstr(new Date());
const ymOf = s => s.slice(0, 7);
const ddOf = s => s.slice(8, 10);
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const mondayOf = s => addDays(s, -((parseD(s).getDay() + 6) % 7));
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const thisYear = () => new Date().getFullYear();
const dayLong = s => { const d = parseD(s); return WDL[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== thisYear() ? ', ' + d.getFullYear() : ''); };
const dayShort = s => { const d = parseD(s); return WD[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== thisYear() ? ', ' + d.getFullYear() : ''); };
const monDay = s => { const d = parseD(s); return MON[d.getMonth()] + ' ' + d.getDate(); };
const fold = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const rid = () => Math.random().toString(36).slice(2, 8);
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const hm12 = t => { if (!t) return ''; const p = t.split(':').map(Number); if (isNaN(p[0])) return ''; const hh = p[0] % 12 || 12; return hh + ':' + pad(p[1] || 0) + (p[0] < 12 ? 'a' : 'p'); };
const clock = ms => { const d = new Date(ms); return hm12(pad(d.getHours()) + ':' + pad(d.getMinutes())); };
const MEALS = { B: 'Breakfast', L: 'Lunch', D: 'Dinner', S: 'Snacks' };
const mealFor = t => { if (!t) return ''; const p = t.split(':').map(Number); const m = p[0] * 60 + (p[1] || 0); return m < 630 ? 'B' : m < 900 ? 'L' : m < 1020 ? 'S' : m < 1290 ? 'D' : 'S'; };
const mealName = m => MEALS[m] || m || '';
const mealCode = text => { const f = fold(text); if (!f) return ''; for (const k in MEALS) if (f === k.toLowerCase() || f === MEALS[k].toLowerCase() || f + 's' === MEALS[k].toLowerCase()) return k; return String(text).trim(); };
const hash = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(36); };

/* A number field that also takes sums: 120+80, 2x150, 300/2. */
function calc(str) {
  const s = String(str).replace(/[x×]/gi, '*').replace(/,/g, '').replace(/\s+/g, '');
  if (!s || !/^[-+*/().\d]+$/.test(s)) return NaN;
  let i = 0;
  const num = () => { const a = i; while (i < s.length && /[\d.]/.test(s[i])) i++; return a === i ? NaN : parseFloat(s.slice(a, i)); };
  const factor = () => {
    if (s[i] === '(') { i++; const v = expr(); if (s[i] !== ')') return NaN; i++; return v; }
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    return num();
  };
  const term = () => { let v = factor(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const v = expr();
  return i === s.length && isFinite(v) ? v : NaN;
}
/* "Oatmeal 150" typed in one box -> {name:"Oatmeal", k:150}. Leading numbers stay part of the name ("2 eggs"). */
function splitTrailing(raw) {
  const m = /^(.*?\S)[\s,:]+(\d[\d+\-*/x×().,]*)$/i.exec(raw.trim());
  if (!m) return null;
  const k = calc(m[2]);
  if (!isFinite(k) || k < 5) return null;
  return { name: m[1].replace(/[\s,:\-]+$/, ''), k };
}

/* ---------------------------------------------------------------------- csv */
/* The repository keeps one file per month, such as log/2026-01.csv, with these columns. Columns the
   logbook does not know are carried through untouched, so adding your own by hand is safe. */
const COLS = ['id', 'date', 'time', 'meal', 'food', 'kcal', 'note'];
function csvRows(text) {
  const rows = [];
  let row = [], cur = '', q = false, open = false, i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === '') { q = true; open = true; }
    else if (c === ',') { row.push(cur); cur = ''; open = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (open || cur !== '' || row.length) { row.push(cur); rows.push(row); }
      row = []; cur = ''; open = false;
    } else { cur += c; open = true; }
  }
  if (q) return { rows, error: 'a quoted value is never closed' };
  if (open || cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { rows };
}
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/* Reads log rows. With `ym` every row must belong to that month. Anything it cannot read exactly is
   reported in `bad` rather than guessed at, and a month with a bad file is never written over. */
function parseLog(text, ym) {
  const out = { list: [], extra: [], bad: null };
  if (!String(text || '').trim()) return out;
  const p = csvRows(text);
  if (p.error) { out.bad = p.error; return out; }
  const head = p.rows[0].map(s => s.trim().toLowerCase()), at = {};
  COLS.forEach(c => { at[c] = head.indexOf(c); });
  if (at.date < 0 || at.food < 0 || at.kcal < 0) { out.bad = 'the first line needs date, food and kcal columns'; return out; }
  const extraAt = [];
  head.forEach((name, i) => { if (name && !COLS.includes(name)) { extraAt.push(i); out.extra.push(p.rows[0][i].trim()); } });
  const seen = new Set(), dup = {};
  for (let r = 1; r < p.rows.length; r++) {
    const row = p.rows[r];
    if (row.every(c => c.trim() === '')) continue;
    const get = c => at[c] >= 0 && at[c] < row.length ? row[at[c]].trim() : '';
    const where = 'row ' + (r + 1) + ': ';
    const date = get('date'), kraw = get('kcal').replace(/,/g, ''), k = Number(kraw), t = get('time');
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || dstr(parseD(date)) !== date) { out.bad = where + 'the date "' + date + '" should look like 2026-01-31'; return out; }
    if (ym && date.slice(0, 7) !== ym) { out.bad = where + 'the date ' + date + ' does not belong in the file for ' + ym; return out; }
    if (kraw === '' || !isFinite(k)) { out.bad = where + 'kcal "' + get('kcal') + '" is not a number'; return out; }
    const e = { i: get('id'), f: get('food'), k: Math.round(k) };
    if (t) { const tm = /^(\d{1,2}):(\d\d)(?::\d\d)?$/.exec(t); if (!tm || +tm[1] > 23 || +tm[2] > 59) { out.bad = where + 'the time "' + t + '" should look like 08:30'; return out; } e.t = pad(+tm[1]) + ':' + tm[2]; }
    const m = mealCode(get('meal')); if (m) e.m = m;
    const n = get('note'); if (n) e.n = n;
    if (extraAt.length) { const x = {}; extraAt.forEach((ci, j) => { const v = ci < row.length ? row[ci] : ''; if (v !== '') x[out.extra[j]] = v; }); if (Object.keys(x).length) e.x = x; }
    if (!e.i) { const sig = [date, e.t || '', e.f, e.k].join('|'); dup[sig] = (dup[sig] || 0) + 1; e.i = 'r' + hash(sig + '#' + dup[sig]); }
    while (seen.has(date + e.i)) e.i += '~';
    seen.add(date + e.i);
    out.list.push({ date, e });
  }
  return out;
}
function monthFromCsv(ym, text) {
  const p = parseLog(text, ym), days = {};
  for (const r of p.list) (days[ddOf(r.date)] = days[ddOf(r.date)] || []).push(r.e);
  return { days, extra: p.extra, bad: p.bad };
}
function csvLines(ym, days, extra) {
  const lines = [];
  for (const dd of Object.keys(days).sort()) for (const e of days[dd]) {
    lines.push([e.i, ym + '-' + dd, e.t || '', mealName(e.m), e.f, e.k, e.n || ''].concat(extra.map(c => e.x && e.x[c] != null ? e.x[c] : '')).map(csvCell).join(','));
  }
  return lines;
}
const monthToCsv = (ym, days, extra) => [COLS.concat(extra).map(csvCell).join(',')].concat(csvLines(ym, days, extra)).join('\n') + '\n';

/* -------------------------------------------------------------------- state */
const S = {
  ready: false, mem: false,
  cfg: { owner: '', repo: '', branch: '', token: '', repoId: 0 },
  view: 'today', date: today(), range: null,
  targets: [{ from: '2000-01-01', k: 2000 }], settingsSha: null, targetsDirty: false,
  months: {},
  lib: [], libMap: new Map(), libDirty: true, usualList: null, usualDay: '',
  edit: null, sugIdx: -1, sugList: [], imp: null, clear: null, switching: null,
  tables: { daily: false, weekday: false },
  busy: false, syncErr: null, lastSync: 0, lastPull: 0, hold: 0, strikes: 0, putBack: { months: 0, entries: 0 },
};
const wide = window.matchMedia('(min-width: 960px)');
const configured = () => !!(S.cfg.owner && S.cfg.repo && S.cfg.token);

/* ------------------------------------------------------------ device storage */
let dbp = null;
const memKv = new Map();
function idb() {
  if (!dbp) dbp = new Promise(res => {
    try {
      const rq = indexedDB.open('calorie-logbook', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return dbp;
}
const kv = {
  async all() {
    const d = await idb();
    if (!d) return [...memKv.entries()];
    return new Promise(res => {
      const out = [], rq = d.transaction('kv').objectStore('kv').openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
      rq.onerror = () => res(out);
    });
  },
  async set(key, val) {
    const d = await idb();
    if (!d) { memKv.set(key, val); return; }
    return new Promise((res, rej) => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
  },
  async clear() {
    const d = await idb();
    memKv.clear();
    if (!d) return;
    return new Promise(res => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').clear(); tx.oncomplete = tx.onerror = tx.onabort = () => res(); });
  },
};
let storeWarned = false, erasing = false;
const keep = (key, val) => erasing ? Promise.resolve() : kv.set(key, val).catch(() => { if (!storeWarned) { storeWarned = true; showNotice('This device could not save that.', 'Its storage may be full. Connect a GitHub repo in Settings so entries are kept there.'); } });

/* -------------------------------------------------------------- month model */
/* Each month holds the copy last seen in the repo (`remote`, at blob `sha`) plus the changes made
   here that the repo does not have yet (`ops`, and `sending` while a save is in flight). What is on
   screen is always remote + sending + ops, so two devices can never overwrite each other's entries. */
function mstate(ym) {
  return S.months[ym] || (S.months[ym] = { ym, remote: {}, sha: null, prev: null, prevAt: 0, gone: false, extra: [], bad: null, ops: {}, sending: null, days: {} });
}
const opsOf = (ops, dd) => ops[dd] || (ops[dd] = { put: new Map(), del: new Map() });
const hasOps = ops => { for (const dd in ops) if (ops[dd].put.size || ops[dd].del.size) return true; return false; };
const hasPuts = ops => { for (const dd in ops) if (ops[dd].put.size) return true; return false; };
/* Only removals, for a month that has no file as far as this device knows: there is nothing to remove
   them from. They are neither sent nor counted, and they take effect if the file ever turns up (a
   write of this device's own that seemed to fail can still land). */
const dormant = st => !st.sha && !st.sending && hasOps(st.ops) && !hasPuts(st.ops);
const hasId = (arr, id) => !!arr && arr.some(e => e.i === id);
/* A change to keep. Kinds: add, edit, move, import, and restore (see restoresOf). `fresh` marks an
   entry that only this device can know about: it was made here, the repo's copy never had it, and no
   write has carried it yet. An imported row is never fresh; its id may exist in a repo not yet seen. */
const opPut = (st, dd, e, at, kind) => {
  const o = opsOf(st.ops, dd), was = o.put.get(e.i);
  const fresh = was ? !!was.fresh : (kind === 'add' || kind === 'move') && !o.del.has(e.i) && !hasId(st.remote[dd], e.i) && !(st.sending && st.sending[dd] && st.sending[dd].put.has(e.i));
  o.del.delete(e.i); o.put.set(e.i, { e, at, kind: fresh && was && kind === 'edit' ? was.kind : kind, fresh });      /* an unsent entry that is corrected is still an addition */
};
/* A removal. Taking back a fresh entry needs nothing sent. Anything GitHub may hold does, whatever
   this device's copy of the file says: an answer can be lost after the write has gone through. */
const opDel = (st, dd, id, name) => {
  const o = opsOf(st.ops, dd), was = o.put.get(id);
  o.put.delete(id);
  if (!(was && was.fresh)) o.del.set(id, name || '');
  if (!o.put.size && !o.del.size) delete st.ops[dd];
};
/* Extra columns: the file's own, plus any that changes still waiting here carry. */
function extrasWith(st, cols) {
  const out = cols.slice();
  for (const ops of [st.sending, st.ops]) if (ops) for (const dd in ops) for (const v of ops[dd].put.values()) for (const c in (v.e.x || {})) if (!out.includes(c)) out.push(c);
  return out;
}
/* A month's last-seen copy, as changes that would write it again (see reupload). */
const idsIn = days => { const out = new Set(); for (const dd in days) for (const e of days[dd]) out.add(e.i); return out; };
function restoresOf(days) {
  const out = {};
  for (const dd in days) { const o = opsOf(out, dd); for (const e of days[dd]) o.put.set(e.i, { e, at: null, kind: 'restore', fresh: false }); }
  return out;
}
/* Once the file turns out to exist, entries queued only to put it back are dropped where the file
   already has them (its version stands). The ones it lacks stay queued and are added to it. */
const dropRestores = (ops, have) => {
  for (const dd of Object.keys(ops)) {
    for (const [id, v] of [...ops[dd].put]) if (v.kind === 'restore' && (!have || have.has(id))) ops[dd].put.delete(id);
    if (!ops[dd].put.size && !ops[dd].del.size) delete ops[dd];
  }
};
/* Entries this device holds because a repository had them: its last-seen copies, and anything queued to go back. */
function heldFromRepo() {
  let n = 0;
  for (const ym in S.months) {
    const st = S.months[ym];
    for (const dd in st.remote) n += st.remote[dd].length;
    for (const ops of [st.sending, st.ops]) if (ops) for (const dd in ops) for (const v of ops[dd].put.values()) if (v.kind === 'restore') n++;
  }
  return n;
}
function applyOps(arr, o) {
  const out = arr.filter(e => !o.del.has(e.i));
  for (const [id, p] of o.put) {
    const i = out.findIndex(x => x.i === id);
    if (i >= 0) out[i] = p.e;
    else if (p.at != null && p.at < out.length) out.splice(p.at, 0, p.e);
    else out.push(p.e);
  }
  return out;
}
function applyAll(days, ops) {
  const out = Object.assign({}, days);
  for (const dd in ops) { const a = applyOps(out[dd] || [], ops[dd]); if (a.length) out[dd] = a; else delete out[dd]; }
  return out;
}
const packOps = ops => { const out = {}; for (const dd in ops) { const o = ops[dd]; if (o.put.size || o.del.size) out[dd] = { put: [...o.put.values()], del: [...o.del.entries()] }; } return out; };
const unpackOps = p => {
  const out = {};
  for (const dd in (p || {})) {
    const o = out[dd] = { put: new Map(), del: new Map() };
    for (const v of (p[dd].put || [])) if (v && v.e && v.e.i) o.put.set(v.e.i, v);
    for (const d of (p[dd].del || [])) if (Array.isArray(d)) o.del.set(d[0], d[1] || '');
  }
  return out;
};
/* `later` on top of `base` */
function joinOps(base, later) {
  const out = unpackOps(packOps(base || {}));
  for (const dd in (later || {})) {
    const o = opsOf(out, dd);
    for (const [id, name] of later[dd].del) { o.put.delete(id); o.del.set(id, name); }
    for (const [id, v] of later[dd].put) { o.del.delete(id); o.put.set(id, v); }
  }
  return out;
}
function cleanDays(days) {
  const out = {};
  if (days && typeof days === 'object') for (const dd of Object.keys(days)) {
    const a = days[dd];
    if (!Array.isArray(a) || !/^\d\d$/.test(dd)) continue;
    const list = a.filter(e => e && typeof e === 'object').map(e => {
      const o = { i: String(e.i || rid()), f: String(e.f == null ? '' : e.f), k: Number(e.k) || 0 };
      if (e.t) o.t = String(e.t);
      if (e.m) o.m = String(e.m);
      if (e.n) o.n = String(e.n);
      if (e.x && typeof e.x === 'object') o.x = Object.assign({}, e.x);
      return o;
    });
    if (list.length) out[dd] = list;
  }
  return out;
}
function refresh(st) {
  let days = st.remote;
  if (st.sending) days = applyAll(days, st.sending);
  days = applyAll(days, st.ops);
  st.days = days;
  S.libDirty = true;
}
const saveMonth = st => keep('month:' + st.ym, { remote: st.remote, sha: st.sha, extra: st.extra, bad: st.bad, gone: st.gone, ops: packOps(joinOps(st.sending, st.ops)) });
const saveSettings = () => keep('settings', { targets: S.targets, sha: S.settingsSha, dirty: S.targetsDirty });
const saveMeta = () => keep('meta', { lastSync: S.lastSync, hold: S.hold, strikes: S.strikes });
/* Changes this device still has to send. With `sendable`, the ones whose month cannot be written
   right now (its file has a line the logbook cannot read) are left out. */
function pendingCount(sendable) {
  let n = S.targetsDirty ? 1 : 0;
  for (const ym in S.months) {
    const st = S.months[ym];
    if (dormant(st) || (sendable && st.bad)) continue;
    for (const ops of [st.sending, st.ops]) if (ops) for (const dd in ops) n += ops[dd].put.size + ops[dd].del.size;
  }
  return n;
}
function entryCount() { let n = 0; for (const ym in S.months) for (const dd in S.months[ym].days) n += S.months[ym].days[dd].length; return n; }
/* A local change: redraw at once, keep it on the device, then send it. */
function changed(st) { refresh(st); saveMonth(st); setSync(); render(); requestSync(700); }

/* ------------------------------------------------------------------- GitHub */
const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };
const b64dec = s => { const bin = atob(String(s).replace(/\s+/g, '')), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder().decode(b); };
function ghFetch(method, path, body, raw, cfg) {
  const c = cfg || S.cfg;
  const opts = {
    method, cache: 'no-store',
    headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  };
  if (window.AbortSignal && AbortSignal.timeout) opts.signal = AbortSignal.timeout(30000);      /* a stalled connection must not hold everything up */
  return fetch('https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + path, opts);
}
async function ghFail(res) {
  let msg = '';
  try { const j = await res.json(); msg = j && j.message || ''; } catch (e) {}
  const left = res.headers.get('x-ratelimit-remaining'), reset = Number(res.headers.get('x-ratelimit-reset')), after = Number(res.headers.get('retry-after'));
  const limited = res.status === 429 || (res.status === 403 && (left === '0' || /rate limit/i.test(msg)));
  const code = res.status === 401 ? 'auth' : limited ? 'rate' : res.status === 404 ? 'missing' : res.status === 403 ? 'forbidden' : 'http';
  /* When limited, GitHub says when to come back: after `retry-after` seconds, or at the reset time once the hour's allowance is used up. */
  const until = !limited ? 0 : after > 0 ? Date.now() + after * 1000 : left === '0' && reset > 0 ? reset * 1000 : 0;
  return { code, status: res.status, message: msg || 'GitHub answered ' + res.status, until };
}
/* Every sync first asks GitHub about the repository and stops, before reading or writing anything,
   if it has been made public, or if it is not the repository this device has been syncing with
   (deleted and created again, say): what is held here is then neither uploaded nor dropped until the
   owner chooses in Settings. */
async function guard() {
  const res = await ghFetch('GET', '');
  if (res.status !== 200) throw await ghFail(res);
  const repo = await res.json();
  if (repo.private === false) throw { code: 'public', message: 'the repository is public' };
  if (repo.id && S.cfg.repoId && repo.id !== S.cfg.repoId && heldFromRepo()) throw { code: 'changed', message: 'this is a different repository' };
  const branch = repo.default_branch || S.cfg.branch, id = repo.id || S.cfg.repoId;
  if (branch !== S.cfg.branch || id !== S.cfg.repoId) { S.cfg = Object.assign({}, S.cfg, { branch, repoId: id }); keep('cfg', S.cfg); }
}
/* Read: one request lists every file with its fingerprint; only months that changed are downloaded,
   one after another. Returns how many downloads that took. */
async function pull() {
  let tree = [], downloads = 0;
  const res = await ghFetch('GET', '/git/trees/' + encodeURIComponent(S.cfg.branch || 'main') + '?recursive=1');
  if (res.status === 200) {
    const j = await res.json();
    if (j.truncated) throw { code: 'http', message: 'the repository has too many files to list' };
    tree = j.tree || [];
  } else if (res.status !== 409 && res.status !== 404) throw await ghFail(res);      /* 409 or 404: nothing has been committed yet */
  const there = new Map();
  let setSha = null;
  for (const t of tree) {
    if (t.type !== 'blob') continue;
    const m = /^log\/(\d{4}-\d\d)\.csv$/.exec(t.path);
    if (m) there.set(m[1], t.sha); else if (t.path === 'settings.json') setSha = t.sha;
  }
  /* A month this device has synced before is not in the listing. The file itself is asked for before
     that is believed (a listing can be behind). If it really is gone, the copy here may be the only
     one left, so it is queued to be written back. (To delete, use Delete history: it leaves the file
     in place with only its header, which is how other devices learn to drop the entries too.) */
  for (const ym of Object.keys(S.months).sort()) {
    const st = S.months[ym];
    if (!st.sha || there.has(ym)) continue;
    const r = await ghFetch('GET', '/contents/log/' + ym + '.csv');
    if (r.status === 200) {
      const j = await r.json();
      if (j && typeof j.sha === 'string') { there.set(ym, j.sha); continue; }      /* it is there after all: treated like any listed file below */
    } else if (r.status !== 404) throw await ghFail(r);
    reupload(st); st.gone = true; refresh(st); saveMonth(st);
  }
  for (const ym of [...there.keys()].sort()) {
    const st = mstate(ym), sha = there.get(ym);
    if (st.sha === sha) continue;
    /* The file as it was before this device's own last write. Just after that write it is taken for a
       listing that is behind, once, and the next one decides. Later it is what it looks like: another
       device has put the file back the way it was. */
    if (st.prev && st.prev === sha) { const late = Date.now() - st.prevAt < 60000; st.prev = null; if (late) continue; }
    const r = await ghFetch('GET', '/git/blobs/' + sha, null, true);
    if (r.status !== 200) throw await ghFail(r);
    downloads++;
    const p = monthFromCsv(ym, await r.text());
    st.bad = p.bad;
    if (!p.bad) { st.remote = p.days; dropRestores(st.ops, idsIn(p.days)); st.extra = extrasWith(st, p.extra); }
    st.sha = sha; st.prev = null;
    refresh(st); saveMonth(st);
  }
  if (setSha && setSha !== S.settingsSha) {
    const r = await ghFetch('GET', '/git/blobs/' + setSha, null, true);
    if (r.status !== 200) throw await ghFail(r);
    downloads++;
    let j = null;
    try { j = JSON.parse(await r.text()); } catch (e) {}
    if (!S.targetsDirty && j && Array.isArray(j.targets)) S.targets = cleanTargets(j.targets);
    S.settingsSha = setSha; saveSettings();
  } else if (!setSha && S.settingsSha) {                                    /* settings.json has gone missing: it goes back too */
    S.settingsSha = null;
    if (S.targets.some(t => t.from !== '2000-01-01')) S.targetsDirty = true;
    saveSettings();
  }
  S.lastPull = Date.now();
  return downloads;
}
/* Turns the copy last seen in the repo into changes that write it again, for a file that is not there
   (any more). Changes already waiting go on top. */
function reupload(st) {
  st.ops = joinOps(restoresOf(st.remote), st.ops);
  st.remote = {}; st.sha = null; st.prev = null; st.bad = null;
}
function describe(ym, ops) {
  let puts = 0, restores = 0, dels = 0;
  for (const dd in ops) { puts += ops[dd].put.size; dels += ops[dd].del.size; for (const v of ops[dd].put.values()) if (v.kind === 'restore') restores++; }
  const rest = puts - restores + dels;
  if (restores) return 'Put back ' + restores + (restores === 1 ? ' entry' : ' entries') + ' for ' + ym + (rest ? ', with ' + rest + (rest === 1 ? ' newer change' : ' newer changes') : '');
  if (!puts && dels > 3) return 'Remove ' + dels + ' entries from ' + ym;
  const parts = [];
  for (const dd of Object.keys(ops).sort()) {
    const day = MON[+ym.slice(5) - 1] + ' ' + (+dd);
    for (const v of ops[dd].put.values()) parts.push((v.kind === 'edit' ? 'Change ' : v.kind === 'move' ? 'Move ' : 'Add ') + v.e.f + ' ' + v.e.k + ' (' + day + ')');
    for (const name of ops[dd].del.values()) parts.push('Remove ' + (name || 'an entry') + ' (' + day + ')');
  }
  const s = parts.length <= 2 ? parts.join('; ') : parts.slice(0, 2).join('; ') + '; and ' + (parts.length - 2) + ' more';
  return s.length > 180 ? s.slice(0, 177) + '...' : s;
}
/* Write one month: apply this device's changes to the newest copy and commit. If GitHub says the
   file moved on (another device saved first), fetch it, apply the same changes again, and retry. */
async function pushMonth(st) {
  if (!hasOps(st.ops)) return;
  let sent = st.sending = st.ops;
  st.ops = {};
  const path = '/contents/log/' + st.ym + '.csv';
  const done = () => { st.sending = null; refresh(st); saveMonth(st); };
  /* the file as GitHub has it now becomes the copy to build on */
  const adopt = j => {
    const p = monthFromCsv(st.ym, b64dec(j.content));
    if (p.bad) { st.bad = p.bad; throw { code: 'badfile', message: 'log/' + st.ym + '.csv: ' + p.bad }; }
    st.remote = p.days; st.sha = j.sha; st.prev = null; st.bad = null;
    dropRestores(sent, idsIn(p.days));
    st.extra = extrasWith(st, p.extra);
  };
  try {
    /* From here on GitHub may hold these entries, whatever answer comes back. That goes on record before the write leaves. */
    for (const dd in sent) for (const v of sent[dd].put.values()) v.fresh = false;
    await Promise.race([saveMonth(st), pause(2000)]);
    for (let attempt = 0; ; attempt++) {
      if (!hasOps(sent)) { done(); return; }
      const merged = applyAll(st.remote, sent);
      if (!st.sha && !Object.keys(merged).length) { st.ops = joinOps(sent, st.ops); done(); return; }      /* nothing to write and no file to change: the removals wait (see dormant) */
      const extra = extrasWith(st, st.extra);
      const res = await ghFetch('PUT', path, Object.assign({ message: describe(st.ym, sent) || 'Update ' + st.ym, content: b64enc(monthToCsv(st.ym, merged, extra)) }, st.sha ? { sha: st.sha } : {}));
      if (res.status === 200 || res.status === 201) {
        const j = await res.json();
        st.prev = st.sha; st.prevAt = Date.now(); st.remote = merged; st.extra = extra; st.sha = j.content && j.content.sha || null;
        if (st.gone) {                                            /* entries written again because their file had gone missing: said once the sync is through */
          let n = 0;
          for (const dd in sent) for (const v of sent[dd].put.values()) if (v.kind === 'restore') n++;
          if (n) { S.putBack.months++; S.putBack.entries += n; }
          st.gone = false;
        }
        done();
        return;
      }
      /* 409 or 422: the file moved on. 404 for a file this device knew: it may have been removed. Look before deciding. */
      if ((res.status === 409 || res.status === 422 || (res.status === 404 && st.sha)) && attempt < 4) {
        const cur = await ghFetch('GET', path);
        if (cur.status === 200) { adopt(await cur.json()); continue; }
        if (cur.status === 404) {
          await guard();                                          /* a repository that is gone or out of reach also answers 404, and is reported as that */
          /* the file has been removed since this device last looked: its copy goes back along with the changes */
          sent = st.sending = joinOps(restoresOf(st.remote), sent);
          st.remote = {}; st.sha = null; st.prev = null; st.gone = true;
          continue;
        }
        throw await ghFail(cur);
      }
      throw await ghFail(res);
    }
  } catch (e) {
    st.ops = joinOps(sent, st.ops); st.sending = null;
    refresh(st); saveMonth(st);
    throw e;
  }
}
async function pushSettings() {
  for (let attempt = 0; ; attempt++) {
    const body = JSON.stringify({ targets: S.targets.map(t => ({ from: t.from, kcal: t.k })) }, null, 2) + '\n';
    const res = await ghFetch('PUT', '/contents/settings.json', Object.assign({ message: 'Change the daily target', content: b64enc(body) }, S.settingsSha ? { sha: S.settingsSha } : {}));
    if (res.status === 200 || res.status === 201) { const j = await res.json(); S.settingsSha = j.content && j.content.sha || null; S.targetsDirty = false; saveSettings(); return; }
    if ((res.status === 409 || res.status === 422) && attempt < 3) {
      const cur = await ghFetch('GET', '/contents/settings.json');
      if (cur.status === 200) { S.settingsSha = (await cur.json()).sha; continue; }
      if (cur.status === 404) { S.settingsSha = null; continue; }
      throw await ghFail(cur);
    }
    throw await ghFail(res);
  }
}
/* Several writes in a row are spaced a second apart, as GitHub asks, and the check on the repository
   is repeated before each of them. The first write of a round follows that round's own check, unless
   the look in between had downloads to make; then it is checked again as well. */
const pause = ms => new Promise(r => setTimeout(r, ms));
async function push(recheck) {
  let wrote = false;
  const ready = async () => { if (wrote) await pause(1000); if (wrote || recheck) await guard(); wrote = true; };
  for (const ym of Object.keys(S.months).sort()) {
    const st = S.months[ym];
    if (!hasOps(st.ops) || st.bad || dormant(st)) continue;
    await ready();
    if (hasOps(st.ops) && !st.bad && !dormant(st)) await pushMonth(st);    /* an undo during the wait can leave nothing to send */
  }
  if (S.targetsDirty) { await ready(); if (S.targetsDirty) await pushSettings(); }
}
/* One sync at a time; a request that arrives mid-sync runs straight after. Every round looks before
   it writes: the privacy check, then what the repo holds now, then this device's changes. */
let syncing = null, queued = 0, wanted = 0, syncTimer = 0, holdTimer = 0;
function requestSync(delay, withPull) {
  if (!configured()) return;
  wanted = Math.max(wanted, withPull ? 2 : 1);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { const w = wanted; wanted = 0; sync(w === 2); }, delay == null ? 700 : delay);
}
/* GitHub can ask for a pause (a rate limit). Nothing more is sent until the time it gave has passed:
   that time, or a minute, doubling if it keeps happening, and never more than an hour. */
function pauseFor(err) {
  S.strikes = Math.min(S.strikes + 1, 7);
  S.hold = Math.min(Math.max(err.until || 0, Date.now() + 60000 * Math.pow(2, S.strikes - 1)), Date.now() + 3600000);
  S.syncErr = err;
  saveMeta(); resumeLater();
}
function resumeLater() {
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { S.hold = 0; sync(true); }, Math.max(1000, S.hold - Date.now() + 1000));
}
function paused() {
  if (S.hold > Date.now() + 3600000) { S.hold = Date.now() + 3600000; saveMeta(); }       /* never more than an hour away, even if the device's clock jumped */
  return S.hold > Date.now();
}
function sync(withPull) {
  if (!configured()) return Promise.resolve();
  if (syncing) { if (withPull || pendingCount(true)) queued = 1; return syncing; }
  if (paused()) { if (!S.syncErr) S.syncErr = { code: 'rate', message: '' }; resumeLater(); setSync(); return Promise.resolve(); }
  if (!withPull && S.lastPull && !S.syncErr && !pendingCount(true)) return Promise.resolve();      /* nothing to send and nobody asked to look */
  S.busy = true; setSync();
  syncing = (async () => {
    try {
      do { queued = 0; await guard(); await push(await pull() > 0); } while (queued);
      S.syncErr = null; S.lastSync = Date.now(); S.hold = 0; S.strikes = 0; saveMeta();
    } catch (e) {
      /* no answer at all (no connection, or a request given up on) is "offline"; the logbook's own errors carry a text code */
      const unreachable = e instanceof TypeError || (e && (e.name === 'TimeoutError' || e.name === 'AbortError'));
      S.syncErr = e && typeof e.code === 'string' ? e : { code: unreachable ? 'offline' : 'bug', message: String(e && e.message || e) };
      queued = 0;
      if (S.syncErr.code === 'rate') pauseFor(S.syncErr);
    }
    if (S.putBack.months) {                                      /* written back without being asked for, so it is said, whatever became of the rest of the round */
      const b = S.putBack, one = b.months === 1;
      S.putBack = { months: 0, entries: 0 };
      showNotice(one ? 'A missing month was put back.' : 'Missing months were put back.', fmt(b.entries) + (b.entries === 1 ? ' entry' : ' entries') + ' in ' + (one ? 'a month file' : b.months + ' month files') + ' held on this device ' + (one && b.entries === 1 ? 'was' : 'were') + ' no longer in ' + S.cfg.owner + '/' + S.cfg.repo + ', so ' + (b.entries === 1 ? 'it was' : 'they were') + ' written there again. To remove history for good, use Delete history in Settings.', 'OK', () => { $('#notice').hidden = true; });
    }
    syncing = null; S.busy = false;
    /* "Connected, N entries in sync" was true when it was written; after a later sync it no longer is */
    const said = $('#gh-msg');
    if (/^(Connected\.|Up to date\.)/.test(said.textContent)) said.textContent = '';
    setSync(); render();
  })();
  return syncing;
}
function explain(err) {
  if (!err) return '';
  const n = pendingCount(), wait = n ? ' ' + fmt(n) + (n === 1 ? ' change is' : ' changes are') + ' waiting on this device and will be sent once this is fixed.' : '';
  if (err.code === 'offline') return 'GitHub can’t be reached right now.' + (n ? ' ' + fmt(n) + (n === 1 ? ' change is' : ' changes are') + ' waiting on this device and will be sent when you are back online.' : '');
  if (err.code === 'auth') return 'GitHub no longer accepts this token. It may have expired or been revoked. Generate a new one and paste it below.' + wait;
  if (err.code === 'missing') return 'GitHub can’t find ' + S.cfg.owner + '/' + S.cfg.repo + ' with this token. Check the name, and that the token’s repository access includes it.' + wait;
  if (err.code === 'forbidden') return 'GitHub refused that (' + err.message + '). The token needs Contents set to Read and write for this repository.' + wait;
  if (err.code === 'rate') return 'GitHub is limiting requests for now. The logbook will try again ' + (S.hold > Date.now() ? 'at ' + clock(S.hold) : 'shortly') + '.' + (n ? ' ' + fmt(n) + (n === 1 ? ' change is' : ' changes are') + ' waiting on this device until then.' : '');
  if (err.code === 'changed') return S.cfg.owner + '/' + S.cfg.repo + ' is not the repository this device has been syncing with; it may have been deleted and created again. Nothing is read from it or sent to it until you choose what happens to the log held here: tap Save below.' + (n ? ' ' + fmt(n) + (n === 1 ? ' change is' : ' changes are') + ' waiting on this device meanwhile.' : '');
  if (err.code === 'public') return 'Anyone can read your log in ' + S.cfg.owner + '/' + S.cfg.repo + '. Nothing more is sent until it is private again: on GitHub open the repository’s Settings, General, Danger Zone, Change visibility.' + wait;
  if (err.code === 'badfile') return 'A file in the repo has a line the logbook can’t read (' + err.message + '). Fix it on GitHub; that month is left untouched until then.';
  return 'Sync stopped: ' + err.message + '.' + wait;
}
function setSync() {
  const el = $('#sync'), n = pendingCount();
  let text, state = '';
  if (!configured()) { text = 'On this device only'; state = 'local'; }
  else if (S.busy) text = 'Syncing…';
  else if (S.syncErr && S.syncErr.code === 'rate') { text = n ? 'Paused · ' + fmt(n) + ' waiting' : 'Paused'; state = 'waiting'; }
  else if (S.syncErr && S.syncErr.code !== 'offline') { text = 'Sync problem'; state = 'error'; }
  else if (S.syncErr || (n && !navigator.onLine)) { text = n ? 'Offline · ' + fmt(n) + ' waiting' : 'Offline'; state = 'waiting'; }
  else if (pendingCount(true)) text = 'Saving…';
  else if (n) { text = fmt(n) + ' waiting'; state = 'waiting'; }
  else text = S.lastSync ? 'Synced ' + clock(S.lastSync) : 'Connected';
  el.textContent = text; el.dataset.state = state;
}

/* --------------------------------------------------------------- day access */
const dayItems = date => { const st = S.months[ymOf(date)]; return (st && st.days[ddOf(date)]) || []; };
const sumK = a => a.reduce((s, e) => s + (Number(e.k) || 0), 0);
const dayTotal = date => sumK(dayItems(date));
function targetFor(date) {
  let k = S.targets.length ? S.targets[0].k : 2000;
  for (const t of S.targets) if (t.from <= date) k = t.k;
  return k;
}
function cleanTargets(a) {
  const out = (Array.isArray(a) ? a : []).map(t => t && { from: t.from, k: Math.round(Number(t.kcal != null ? t.kcal : t.k)) }).filter(t => t && /^\d{4}-\d\d-\d\d$/.test(t.from) && t.k > 0);
  out.sort((x, y) => x.from < y.from ? -1 : 1);
  return out.length ? out : [{ from: '2000-01-01', k: 2000 }];
}
function orderedItems(date) {
  const a = dayItems(date);
  if (a.length && a.every(e => e.t)) return a.slice().sort((x, y) => x.t < y.t ? -1 : x.t > y.t ? 1 : 0);
  return a;
}
function usable(date) {
  const st = mstate(ymOf(date));
  if (st.bad) { toast('log/' + st.ym + '.csv has a line the logbook can’t read, so that month is locked. See Settings.'); return null; }
  return st;
}

/* ------------------------------------------------------------- food library */
/* Worked out from the log itself: every food you have logged, how often, and at which calorie values. */
function library() {
  if (!S.libDirty) return S.lib;
  const map = new Map();
  for (const ym of Object.keys(S.months).sort()) {
    const st = S.months[ym];
    for (const dd of Object.keys(st.days).sort()) {
      const date = ym + '-' + dd;
      for (const e of st.days[dd]) {
        const key = fold(e.f);
        if (!key || /^\(.*\)$/.test(key)) continue;            /* a placeholder in brackets is not a food */
        let it = map.get(key);
        if (!it) map.set(key, it = { n: e.f, c: 0, l: '', vm: new Map() });
        it.c++; it.n = e.f; it.l = date;
        const v = it.vm.get(e.k) || [e.k, 0, ''];
        v[1]++; v[2] = date; it.vm.set(e.k, v);
      }
    }
  }
  S.lib = [...map.values()].map(it => ({ n: it.n, c: it.c, l: it.l, v: [...it.vm.values()].sort((a, b) => b[1] - a[1] || (a[2] < b[2] ? 1 : -1)) }));
  S.lib.sort((a, b) => b.c - a.c || (a.n < b.n ? -1 : 1));
  S.libMap = new Map(S.lib.map(it => [fold(it.n), it]));
  S.libDirty = false;
  return S.lib;
}
const libFind = name => { library(); return S.libMap.get(fold(name)); };
function canonName(name) {
  const it = libFind(name);
  if (it) return it.n;
  const s = name.trim().replace(/\s+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/* The one-tap list: what you log most, weighted toward what you logged lately. Its order holds
   still for the day so the buttons do not shuffle under your thumb while you are logging. */
function usuals() {
  const now = today(), out = [];
  for (const it of library()) {
    for (const v of it.v.slice(0, 2)) {
      const age = Math.max(0, daysBetween(v[2] || it.l || now, now));
      out.push({ n: it.n, k: v[0], s: v[1] * Math.pow(0.5, age / 45) });
    }
  }
  out.sort((a, b) => b.s - a.s);
  if (!S.ready) return out.slice(0, 8);
  const key = u => fold(u.n) + '|' + u.k;
  if (S.usualList && S.usualDay === now) {
    const have = new Set(out.map(key));
    const kept = S.usualList.filter(u => have.has(key(u)));
    const seen = new Set(kept.map(key));
    for (const u of out) { if (kept.length >= 8) break; if (!seen.has(key(u))) { kept.push(u); seen.add(key(u)); } }
    return S.usualList = kept;
  }
  S.usualDay = now;
  return S.usualList = out.slice(0, 8);
}
function suggest(q) {
  const f = fold(q);
  if (!f) return [];
  const a = [], b = [], c = [];
  for (const it of library()) {
    const n = fold(it.n);
    if (n.startsWith(f)) a.push(it);
    else if (n.split(/[\s+&,/()-]+/).some(w => w.startsWith(f))) b.push(it);
    else if (f.length >= 3 && n.includes(f)) c.push(it);
  }
  const by = (x, y) => y.c - x.c;
  return a.sort(by).concat(b.sort(by), c.sort(by)).slice(0, 6);
}

/* ---------------------------------------------------------------- mutations */
function addEntries(list, date) {
  const st = usable(date);
  if (!st) return false;
  const dd = ddOf(date), stamp = date === today() ? nowHM() : '';
  const added = list.map(x => {
    const e = { i: rid(), f: canonName(x.name), k: Math.round(x.k) };
    if (stamp) { e.t = stamp; e.m = mealFor(stamp); }
    return e;
  });
  for (const e of added) opPut(st, dd, e, null, 'add');
  changed(st);
  const what = added.length === 1 ? added[0].f + ' · ' + fmt(added[0].k) + ' kcal' : added.length + ' items · ' + fmt(sumK(added)) + ' kcal';
  toast('Added ' + what + (date === today() ? '' : ' to ' + monDay(date)), 'Undo', () => {
    for (const e of added) opDel(st, dd, e.i, e.f);
    changed(st);
  });
  return true;
}
function removeEntry(date, id) {
  const st = usable(date);
  if (!st) return;
  const dd = ddOf(date), cur = st.days[dd] || [], idx = cur.findIndex(e => e.i === id);
  if (idx < 0) return;
  const gone = cur[idx];
  opDel(st, dd, id, gone.f);
  S.edit = null;
  changed(st);
  toast('Removed ' + gone.f, 'Undo', () => { opPut(st, dd, gone, idx, 'add'); changed(st); });
}
function saveEdit(form) {
  const ed = S.edit;
  if (!ed) return;
  const name = form.querySelector('[data-f="food"]').value.trim();
  const k = calc(form.querySelector('[data-f="kcal"]').value);
  const time = form.querySelector('[data-f="time"]').value;
  const meal = form.querySelector('[data-f="meal"]').value;
  const newDate = form.querySelector('[data-f="date"]').value || ed.date;
  const msg = form.querySelector('.hint');
  if (!name) { msg.textContent = 'Give the entry a name.'; return; }
  if (!isFinite(k) || k < 0 || k > 20000) { msg.textContent = 'Calories should be a number. Sums like 120+80 work too.'; return; }
  if (!/^\d{4}-\d\d-\d\d$/.test(newDate) || newDate > today()) { msg.textContent = 'Pick a date up to today.'; return; }
  const src = usable(ed.date);
  if (!src) return;
  const dd = ddOf(ed.date), cur = src.days[dd] || [], idx = cur.findIndex(e => e.i === ed.id);
  if (idx < 0) { S.edit = null; render(); return; }
  const e = Object.assign({}, cur[idx], { f: name.replace(/\s+/g, ' '), k: Math.round(k) });
  if (time) e.t = time; else delete e.t;
  const m = meal || mealFor(time);
  if (m) e.m = m; else delete e.m;
  const dst = newDate === ed.date ? src : usable(newDate);
  if (!dst) return;                                             /* the form stays open; the toast says why */
  S.edit = null;
  if (newDate === ed.date) { opPut(src, dd, e, idx, 'edit'); changed(src); }
  else {
    opDel(src, dd, ed.id, e.f);
    opPut(dst, ddOf(newDate), e, null, 'move');
    if (dst !== src) { refresh(src); saveMonth(src); }
    changed(dst);
  }
  toast(newDate === ed.date ? 'Saved' : 'Moved to ' + monDay(newDate));
}

/* ------------------------------------------------------------------- notices */
function showNotice(title, body, action, fn) {
  const n = $('#notice');
  n.textContent = '';
  n.append(h('span', null, h('b', { text: title + ' ' }), body));
  if (action) n.append(h('button', { class: 'btn small', type: 'button', text: action, onclick: fn }));
  n.hidden = false;
}
let toastTimer = 0;
function toast(text, action, fn) {
  const t = $('#toast');
  clearTimeout(toastTimer);
  t.textContent = '';
  t.append(h('span', { text }));
  if (action) t.append(h('button', { type: 'button', text: action, onclick: () => { t.hidden = true; fn(); } }));
  t.hidden = false;
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3200);
}
function hint(text) { $('#hint').textContent = text || ''; }
/* Buttons that delete ask twice: the first tap changes the label, a second within eight seconds goes ahead. */
function disarm(btn) {
  if (!btn.armed) return;
  clearTimeout(btn.armed); btn.armed = 0;
  btn.textContent = btn.was; btn.classList.remove('warn');
  $('#say').textContent = '';
}
function twice(btn, label, fn, lapsed) {
  if (btn.armed) { disarm(btn); fn(); return; }
  btn.was = btn.textContent;
  btn.textContent = label; btn.classList.add('warn');
  $('#say').textContent = label + '.';                            /* a screen reader hears the changed label */
  btn.armed = setTimeout(() => { disarm(btn); if (lapsed) lapsed(); }, 8000);
}

/* --------------------------------------------------------------------- views */
const VIEWS = ['today', 'trends', 'history', 'settings'];
function setView(v, push) {
  S.view = v;
  if (push !== false) { try { history.replaceState(null, '', '#' + v); } catch (e) {} }
  render();
}
function setDate(d) {
  if (d > today()) d = today();
  S.date = d; S.edit = null;
  render();
}
function render() {
  const w = wide.matches, v = S.view;
  for (const t of document.querySelectorAll('.tab')) {
    const on = t.dataset.view === v || (w && t.dataset.view === 'today' && v === 'trends');
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  const vt = $('#view-today'), vr = $('#view-trends'), vh = $('#view-history'), vs = $('#view-settings');
  vt.hidden = !(w || v === 'today');
  vr.hidden = !(v === 'trends' || (w && v === 'today'));
  vh.hidden = v !== 'history';
  vs.hidden = v !== 'settings';
  if (!vt.hidden) renderToday();
  if (!vr.hidden) renderTrends();
  if (!vh.hidden) renderHistory();
  if (!vs.hidden) renderSettings();
}

/* ---------------------------------------------------------------- today view */
function renderToday() {
  const date = S.date, now = today(), isToday = date === now, loaded = S.ready;
  $('#day-title').textContent = dayLong(date);
  const ago = daysBetween(date, now);
  let tag = isToday ? 'TODAY' : ago === 1 ? 'YESTERDAY' : fmt(ago) + ' DAYS AGO';
  if (isToday && loaded) { const run = streaks(allDayTotals()).cur; if (run >= 2) tag += ' · ' + fmt(run) + '-DAY STREAK'; }
  $('#day-tag').textContent = tag;
  $('#go-today').hidden = isToday;
  $('#next-day').disabled = isToday;
  const jd = $('#jump-date');
  if (document.activeElement !== jd) jd.value = date;
  jd.max = now;

  const items = orderedItems(date), total = sumK(items), target = targetFor(date);

  /* week strip: seven columns sharing one scale, target as a hairline */
  const mon = mondayOf(date), week = [];
  for (let i = 0; i < 7; i++) { const d = addDays(mon, i); week.push({ d, total: dayTotal(d), target: targetFor(d) }); }
  const scale = Math.max(1, ...week.map(x => Math.max(x.total, x.target * 1.25)));
  const wk = $('#week');
  wk.textContent = '';
  for (const x of week) {
    const future = x.d > now, pd = parseD(x.d);
    const within = Math.min(x.total, x.target), over = Math.max(0, x.total - x.target);
    const col = h('span', { class: 'wk-col', style: 'height:' + (x.total / scale * 100).toFixed(2) + '%' });
    if (over > 0) col.append(h('i', { class: 'seg-over', style: 'flex:' + over }));
    if (within > 0) col.append(h('i', { class: 'seg-in', style: 'flex:' + within }));
    wk.append(h('button', {
      class: 'wk', type: 'button', disabled: future, 'aria-current': x.d === date ? 'date' : null,
      'aria-label': dayShort(x.d) + (future ? '' : x.total ? ': ' + fmt(x.total) + ' kcal' : ': nothing logged'),
      onclick: () => setDate(x.d),
    },
      h('span', { class: 'wk-plot' }, x.total ? col : null, h('span', { class: 'wk-t', style: 'bottom:' + (x.target / scale * 100).toFixed(2) + '%' })),
      h('span', { class: 'wk-lab', text: WD[pd.getDay()].charAt(0) + ' ' + pd.getDate() })));
  }

  /* meter + hero */
  const meter = $('#meter');
  meter.textContent = '';
  if (total <= target) {
    if (total > 0) meter.append(h('i', { class: 'm-in', style: 'width:' + (total / target * 100).toFixed(2) + '%' }));
    meter.append(h('i', { class: 'm-rest' }));
  } else {
    meter.append(h('i', { class: 'm-in', style: 'width:' + (target / total * 100).toFixed(2) + '%' }), h('i', { class: 'm-over', style: 'flex:1' }));
  }
  meter.setAttribute('aria-label', fmt(total) + ' of ' + fmt(target) + ' kcal eaten');
  $('#amount').textContent = 'Daily target ' + fmt(target) + ' kcal';
  $('#hero-name').textContent = total > target ? 'Calories over' : 'Calories left';
  $('#hero-val').textContent = loaded ? fmt(Math.abs(target - total)) : '–';

  /* usuals */
  const chips = $('#chips'), us = usuals();
  chips.textContent = '';
  $('#usual-head').hidden = !us.length;
  for (const u of us) chips.append(h('button', { class: 'chip', type: 'button', 'aria-label': 'Add ' + u.n + ', ' + fmt(u.k) + ' kcal', onclick: () => addEntries([{ name: u.n, k: u.k }], S.date) }, h('span', { text: u.n }), h('b', { text: fmt(u.k) })));
  if (!us.length && loaded) chips.append(h('p', { class: 'quiet', text: 'Foods you log more than once will show up here as one-tap buttons.' }));
  const note = $('#add-note');
  note.hidden = isToday;
  note.textContent = isToday ? '' : 'Adding to ' + dayShort(date) + ', not today.';

  /* ledger */
  $('#ledger-title').textContent = !loaded ? 'Logged' : items.length ? items.length + (items.length === 1 ? ' item logged' : ' items logged') : 'Nothing logged';
  const rows = $('#rows');
  const editing = S.edit && S.edit.date === date && rows.contains(document.activeElement) && rows.querySelector('.edit');
  if (!editing) {
    const timed = items.some(e => e.t);
    rows.classList.toggle('no-time', !timed);
    rows.textContent = '';
    if (!loaded) rows.append(h('li', null, h('p', { class: 'empty', text: 'Opening your log…' })));
    else if (!items.length) rows.append(h('li', null, h('p', { class: 'empty', text: isToday ? 'Nothing yet today. Type a food and its calories above, then Add. “Oatmeal 150” in the first box works too.' : 'Nothing was logged on this day.' })));
    for (const e of items) {
      if (S.edit && S.edit.id === e.i && S.edit.date === date) { rows.append(h('li', null, editForm(e, date))); continue; }
      rows.append(h('li', null, h('button', { class: 'row', type: 'button', 'aria-label': 'Edit ' + e.f + ', ' + fmt(e.k) + ' kcal', onclick: () => { S.edit = { date, id: e.i }; renderToday(); const f = rows.querySelector('.edit [data-f="kcal"]'); if (f) { f.focus(); f.select(); } } },
        timed ? h('span', { class: 'r-time', text: hm12(e.t) }) : null,
        h('span', { class: 'r-food' }, e.f || '(unnamed)', e.n ? h('small', { text: e.n }) : null),
        h('span', { class: 'r-kcal', text: fmt(e.k) }),
        h('span', { class: 'r-pct', text: Math.round(e.k / target * 100) + '%' }))));
    }
  }

  /* totals */
  const sums = $('#sums');
  sums.textContent = '';
  const line = (label, value, extra) => h('div', { class: 'sum' }, h('span', null, h('b', { text: label }), extra ? h('span', { class: 'soft', text: ' ' + extra }) : null), h('span', { class: 'v', text: value }));
  const pct = total > target ? Math.max(101, Math.round(total / target * 100)) : Math.round(total / target * 100);
  sums.append(line('Eaten', loaded ? fmt(total) : '–', loaded && total ? pct + '% of target' : ''));
  const meals = new Map();
  for (const e of items) if (e.m) meals.set(e.m, (meals.get(e.m) || 0) + e.k);
  for (const m of ['B', 'L', 'D', 'S'].concat([...meals.keys()].filter(k => !MEALS[k]))) if (meals.get(m)) sums.append(h('div', { class: 'sum sub' }, h('span', { class: 'soft', text: mealName(m) }), h('span', { class: 'soft', text: fmt(meals.get(m)) })));
  let n7 = 0, s7 = 0;
  for (let i = 0; i < 7; i++) { const t = dayTotal(addDays(date, -i)); if (t) { n7++; s7 += t; } }
  sums.append(line('7-day average', n7 ? fmt(s7 / n7) : '–', n7 ? n7 + (n7 === 1 ? ' day logged' : ' days logged') : ''));
  const foot = $('#foot');
  foot.textContent = '';
  foot.append('* Share of your ' + fmt(target) + ' kcal daily target. Tap an entry to change or remove it. ',
    h('button', { class: 'link', type: 'button', text: 'Change target', style: 'font-size:12.5px;padding:0', onclick: () => { const f = $('#target-form'); f.hidden = false; const i = $('#target-input'); i.value = targetFor(today()); i.focus(); i.select(); } }));
}
function editForm(e, date) {
  const custom = e.m && !MEALS[e.m] ? e.m : '';
  const f = h('form', { class: 'edit', novalidate: true, onsubmit: ev => { ev.preventDefault(); saveEdit(f); } },
    h('label', { class: 'wide' }, 'Food', h('input', { class: 'field', id: 'edit-food', 'data-f': 'food', type: 'text', value: e.f })),
    h('label', null, 'Calories', h('input', { class: 'field num', id: 'edit-kcal', 'data-f': 'kcal', type: 'text', inputmode: 'decimal', value: e.k })),
    h('label', null, 'Time', h('input', { class: 'field', id: 'edit-time', 'data-f': 'time', type: 'time', value: e.t || '' })),
    h('label', null, 'Meal', h('select', { class: 'field', id: 'edit-meal', 'data-f': 'meal' },
      h('option', { value: '', text: 'By time of day' }),
      ...Object.keys(MEALS).map(k => h('option', { value: k, text: MEALS[k], selected: e.m === k })),
      custom ? h('option', { value: custom, text: custom, selected: true }) : null)),
    h('label', null, 'Date', h('input', { class: 'field', id: 'edit-date', 'data-f': 'date', type: 'date', value: date, max: today() })),
    h('p', { class: 'hint wide', 'aria-live': 'polite' }),
    h('div', { class: 'edit-actions' },
      h('button', { class: 'btn small', type: 'submit', text: 'Save' }),
      h('button', { class: 'btn ghost small', type: 'button', text: 'Cancel', onclick: () => { S.edit = null; renderToday(); } }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost small', type: 'button', text: 'Remove', onclick: () => removeEntry(date, e.i) })));
  return f;
}

/* ------------------------------------------------------------------- adding */
function renderSugs() {
  const box = $('#sugs'), input = $('#food');
  const raw = input.value, split = splitTrailing(raw);
  const list = S.sugList = split ? [] : suggest(raw);
  box.textContent = '';
  if (S.sugIdx >= list.length) S.sugIdx = -1;
  list.forEach((it, i) => {
    const li = h('li', { class: 'sug', role: 'option', id: 'sug-' + i, 'aria-selected': i === S.sugIdx ? 'true' : 'false' },
      h('button', { class: 'sug-name', type: 'button', tabindex: -1, text: it.n, onclick: () => pickSug(it) }));
    for (const v of it.v.slice(0, 3)) li.append(h('button', { class: 'kc', type: 'button', tabindex: -1, text: fmt(v[0]), 'aria-label': 'Add ' + it.n + ', ' + fmt(v[0]) + ' kcal', onclick: () => { clearAdd(); addEntries([{ name: it.n, k: v[0] }], S.date); } }));
    box.append(li);
  });
  box.hidden = !list.length;
  input.setAttribute('aria-expanded', list.length ? 'true' : 'false');
  if (S.sugIdx >= 0) input.setAttribute('aria-activedescendant', 'sug-' + S.sugIdx); else input.removeAttribute('aria-activedescendant');
}
function pickSug(it) {
  $('#food').value = it.n;
  const k = $('#kcal');
  k.value = it.v.length ? it.v[0][0] : '';
  S.sugIdx = -1; renderSugs();
  $('#sugs').hidden = true;
  k.focus(); k.select();
}
function clearAdd() { $('#food').value = ''; $('#kcal').value = ''; S.sugIdx = -1; renderSugs(); hint(''); }
function submitAdd() {
  const raw = $('#food').value.trim(), kraw = $('#kcal').value.trim();
  let name = raw, k = NaN;
  if (kraw) k = calc(kraw);
  else { const p = splitTrailing(raw); if (p) { name = p.name; k = p.k; } }
  if (!name) { hint('Type what you ate first.'); $('#food').focus(); return; }
  if (kraw && !isFinite(k)) { hint('Calories should be a number. Sums like 120+80 work too.'); $('#kcal').focus(); return; }
  if (!isFinite(k)) {
    const it = libFind(name);
    if (it && it.v.length === 1) k = it.v[0][0];
    else if (it && it.v.length > 1) { hint(it.n + ' has been ' + it.v.slice(0, 3).map(v => fmt(v[0])).join(', ') + ' before. Tap one of those, or type the calories.'); $('#kcal').focus(); return; }
  }
  if (!isFinite(k)) { hint('Add the calories for this one.'); $('#kcal').focus(); return; }
  if (k < 0 || k > 20000) { hint('That calorie number looks off.'); $('#kcal').focus(); return; }
  clearAdd();
  addEntries([{ name, k }], S.date);
  $('#food').focus();
}

/* ------------------------------------------------------------------- charts */
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, parent, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; if (parent) parent.appendChild(n); return n; };
const topRound = (x, y, w, hh, r) => { r = Math.max(0, Math.min(r, w / 2, hh)); return 'M' + x + ',' + (y + hh) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hh) + 'Z'; };

/* One column chart: a single series, stacked only where a day runs past its target. */
function drawColumns(host, buckets, opt) {
  host.textContent = '';
  const W = Math.max(240, Math.floor(host.clientWidth || 320)), H = opt.height || 216;
  const m = { l: 42, r: 4, t: opt.caps ? 22 : 10, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const vmax = Math.max(1, ...buckets.map(b => Math.max(b.v || 0, b.target || 0)));
  const step = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find(s => vmax * 1.04 / s <= 4.2) || 10000;
  const ymax = Math.ceil(vmax * 1.04 / step) * step;
  const y = v => m.t + ph - v / ymax * ph;
  const svg = sv('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', tabindex: 0, 'aria-label': opt.label }, host);
  const hl = sv('rect', { class: 'hl', x: 0, y: m.t, width: 0, height: ph, visibility: 'hidden' }, svg);
  for (let v = 0; v <= ymax + 1e-6; v += step) {
    sv('line', { class: v === 0 ? 'axis' : 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
    sv('text', { class: 'tick', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg, fmt(v));
  }
  const n = buckets.length, band = pw / n, bw = Math.max(1.5, Math.min(24, band * 0.64, band - 2));
  const cx = i => m.l + band * i + band / 2;
  let hi = -1, lo = -1;
  buckets.forEach((b, i) => { if (b.v == null) return; if (hi < 0 || b.v > buckets[hi].v) hi = i; if (lo < 0 || b.v < buckets[lo].v) lo = i; });
  buckets.forEach((b, i) => {
    if (b.gap) {
      const c = cx(i), y0 = y(0);
      sv('rect', { class: 'brk-bg', x: c - 8, y: y0 - 2, width: 16, height: 4 }, svg);
      sv('path', { class: 'brk', d: 'M' + (c - 6) + ',' + (y0 + 5) + 'l4,-10M' + (c + 2) + ',' + (y0 + 5) + 'l4,-10' }, svg);
      return;
    }
    if (b.v == null) return;
    const x = cx(i) - bw / 2, t = b.target || Infinity;
    const within = Math.min(b.v, t), over = Math.max(0, b.v - t);
    const gap = over > 0 && (y(within) - y(b.v)) > 3 ? 2 : 0;
    if (within > 0) sv('path', { class: 'bar-in', d: topRound(x, y(within), bw, y(0) - y(within), over > 0 ? 0 : 4) }, svg);
    if (over > 0) sv('path', { class: 'bar-over', d: topRound(x, y(b.v), bw, Math.max(1, y(within) - y(b.v) - gap), 4) }, svg);
    if (opt.caps && (band >= 38 || i === hi || i === lo)) sv('text', { class: 'cap', x: cx(i), y: y(b.v) - 6, 'text-anchor': 'middle' }, svg, fmt(b.v));
  });
  /* target: one stepped line across the plot */
  let d = '', pen = false;
  buckets.forEach((b, i) => {
    if (!b.target) { pen = false; return; }
    const yy = (y(b.target) - (opt.caps ? 0 : 1)).toFixed(1);
    d += (pen ? 'L' : 'M') + (m.l + band * i).toFixed(1) + ',' + yy + 'L' + (m.l + band * (i + 1)).toFixed(1) + ',' + yy;
    pen = true;
  });
  if (d) sv('path', { class: 'tline', d }, svg);
  /* x labels: every column when few, otherwise as many as the width holds */
  const want = n <= 8 ? n : Math.max(2, Math.min(n, 6, Math.floor(pw / 68)));
  const idx = new Set();
  for (let j = 0; j < want; j++) idx.add(Math.round(j * (n - 1) / Math.max(1, want - 1)));
  for (const i of idx) {
    if (buckets[i].gap) continue;
    const edge = n > 8 && (i === 0 || i === n - 1);
    const b = buckets[i], tight = n <= 8 && band < 58 && b.short && i > 0 && !b.lead;
    sv('text', { class: 'tick', x: edge ? (i === 0 ? m.l : W - m.r) : cx(i), y: H - 6, 'text-anchor': edge ? (i === 0 ? 'start' : 'end') : 'middle' }, svg, tight ? b.short : b.label);
  }
  sv('rect', { class: 'hit', x: m.l, y: 0, width: pw, height: H }, svg);

  const tip = h('div', { class: 'tip', hidden: true });
  host.append(tip);
  let active = -1;
  const show = i => {
    if (i < 0 || i >= n) return hide();
    active = i;
    const b = buckets[i];
    hl.setAttribute('x', m.l + band * i); hl.setAttribute('width', band); hl.setAttribute('visibility', 'visible');
    tip.textContent = '';
    tip.append(h('strong', { text: b.v == null ? 'Nothing logged' : fmt(b.v) + (opt.unit || ' kcal') }), h('span', { text: b.tip }));
    if (b.v != null && b.target) { const dlt = Math.round(b.v - b.target); tip.append(h('span', { text: dlt === 0 ? 'Right on target' : fmt(Math.abs(dlt)) + (dlt > 0 ? ' over target' : ' under target'), style: 'display:block' })); }
    if (b.note) tip.append(h('span', { text: b.note, style: 'display:block' }));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const top = y(Math.max(b.v || 0, b.target || 0)) - th - 8;
    tip.style.left = Math.max(0, Math.min(W - tw, cx(i) - tw / 2)) + 'px';
    tip.style.top = Math.max(0, top) + 'px';
  };
  const hide = () => { active = -1; tip.hidden = true; hl.setAttribute('visibility', 'hidden'); };
  const at = ev => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width); return Math.max(0, Math.min(n - 1, Math.floor((px - m.l) / band))); };
  svg.addEventListener('pointermove', ev => show(at(ev)));
  svg.addEventListener('pointerdown', ev => show(at(ev)));
  svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') hide(); });
  svg.addEventListener('focus', () => { if (active < 0) { let i = n - 1; while (i > 0 && buckets[i].v == null) i--; show(i); } });
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); show(Math.max(0, active - 1)); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); show(Math.min(n - 1, active + 1)); }
    else if (ev.key === 'Escape') hide();
  });
}
function tableOf(cols, rows) {
  const t = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map(c => h('th', { scope: 'col', text: c })))));
  const tb = h('tbody');
  for (const r of rows) tb.append(h('tr', null, r.map(c => h('td', { text: c }))));
  t.append(tb);
  return h('div', { class: 'tbl-wrap' }, t);
}
function figure(key, title, sub, draw, table, legend) {
  const plot = h('div', { class: 'plot' });
  const btn = h('button', { class: 'link', type: 'button', text: S.tables[key] ? 'Show chart' : 'Show table', onclick: () => { S.tables[key] = !S.tables[key]; renderTrends(); } });
  const fig = h('figure', { class: 'fig' }, h('div', { class: 'fig-head' }, h('figcaption', { class: 'fig-title', text: title }), btn), sub ? h('p', { class: 'fig-sub', text: sub }) : null, plot);
  if (S.tables[key]) plot.append(table());
  else { fig.append(legend || ''); queueMicrotask(() => draw(plot)); }
  return fig;
}

/* --------------------------------------------------------------- trends view */
function allDayTotals() {
  const out = new Map();
  for (const ym in S.months) { const st = S.months[ym]; for (const dd in st.days) { const a = st.days[dd]; if (a && a.length) out.set(ym + '-' + dd, sumK(a)); } }
  return out;
}
function streaks(totals) {
  const dates = [...totals.keys()].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of dates) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; if (run > longest) longest = run; prev = d; }
  let cur = 0, d = today();
  if (!totals.has(d)) d = addDays(d, -1);
  while (totals.has(d)) { cur++; d = addDays(d, -1); }
  return { cur, longest };
}
let trendsTimer = 0;
function renderTrends() {
  const body = $('#trends-body');
  if (!S.ready) return;
  const totals = allDayTotals(), end = today();
  const dates = [...totals.keys()].sort();
  if (S.range == null) {
    let recent = 0;
    for (let i = 0; i < 30; i++) if (totals.has(addDays(end, -i))) recent++;
    S.range = recent >= 3 ? '30' : 'all';
  }
  for (const b of document.querySelectorAll('.range')) b.setAttribute('aria-pressed', b.dataset.range === S.range ? 'true' : 'false');
  const first = dates[0] || end;
  const start = S.range === 'all' ? first : addDays(end, -(Number(S.range) - 1));
  const span = daysBetween(start, end) + 1;
  $('#range-note').textContent = monDay(start) + (parseD(start).getFullYear() !== thisYear() ? ', ' + parseD(start).getFullYear() : '') + ' to ' + monDay(end) + ', ' + thisYear();
  body.textContent = '';
  const inRange = dates.filter(d => d >= start && d <= end);
  if (!inRange.length) {
    body.append(h('p', { class: 'empty', text: dates.length ? 'Nothing logged in this range. Pick a longer one to see earlier entries.' : 'Trends appear here once you have logged a day or two.' }));
    return;
  }
  /* headline numbers */
  let sum = 0, tsum = 0, within = 0;
  for (const d of inRange) { const v = totals.get(d), t = targetFor(d); sum += v; tsum += t; if (v <= t) within++; }
  const avg = sum / inRange.length, tavg = tsum / inRange.length, delta = Math.round(avg - tavg), st = streaks(totals);
  const kpi = (label, value, subText) => h('div', { class: 'kpi' }, h('div', { class: 'label', text: label }), h('div', { class: 'v', text: value }), h('div', { class: 's', text: subText }));
  body.append(h('div', { class: 'kpis' },
    kpi('Average per day', fmt(avg), delta === 0 ? 'right on target' : fmt(Math.abs(delta)) + ' kcal ' + (delta > 0 ? 'over' : 'under') + ' target'),
    kpi('Days on target', within + ' of ' + inRange.length, 'at or under it, ' + Math.round(within / inRange.length * 100) + '% of logged days'),
    kpi('Days logged', fmt(inRange.length), 'of ' + fmt(span) + ' in this range'),
    kpi('Logging streak', st.cur + (st.cur === 1 ? ' day' : ' days'), 'longest so far ' + fmt(st.longest))));

  /* daily / weekly / monthly columns */
  const mode = span <= 45 ? 'day' : span <= 200 ? 'week' : 'month';
  const groups = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = mode === 'day' ? d : mode === 'week' ? mondayOf(d) : ymOf(d);
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, n: 0, sum: 0, tsum: 0, first: d });
    if (totals.has(d)) { g.n++; g.sum += totals.get(d); g.tsum += targetFor(d); }
  }
  const buckets = [...groups.values()].map(g => {
    const pd = parseD(g.first);
    const b = { key: g.key, v: g.n ? g.sum / g.n : null, target: g.n ? g.tsum / g.n : targetFor(g.first), n: g.n };
    if (mode === 'day') { b.label = monDay(g.key); b.short = String(pd.getDate()); b.lead = pd.getDate() === 1; b.tip = dayShort(g.key); }
    else if (mode === 'week') { b.label = monDay(g.key); b.tip = 'Week of ' + monDay(g.key); b.note = g.n + (g.n === 1 ? ' day logged' : ' days logged'); }
    else { b.label = MON[pd.getMonth()] + ' ’' + String(pd.getFullYear()).slice(2); b.tip = MONL[pd.getMonth()] + ' ' + pd.getFullYear(); b.note = g.n + (g.n === 1 ? ' day logged' : ' days logged'); }
    return b;
  });
  /* "All" can include long stretches with nothing logged; four or more empty columns in a row fold into one marked break */
  let cols = buckets;
  if (S.range === 'all' && mode !== 'day') {
    cols = [];
    let run = [];
    const fold4 = () => {
      if (run.length >= 4) cols.push({ gap: true, v: null, target: null, n: 0, label: '', tip: run[0].tip.replace('Week of ', '') + ' to ' + run[run.length - 1].tip.replace('Week of ', ''), note: run.length + (mode === 'week' ? ' weeks' : ' months') + ' folded into this break' });
      else cols.push(...run);
      run = [];
    };
    for (const b of buckets) { if (b.v == null) run.push(b); else { fold4(); cols.push(b); } }
    fold4();
  }
  const folded = cols.some(b => b.gap);
  const anyOver = cols.some(b => b.v != null && b.v > b.target);
  const legend = h('div', { class: 'legend' },
    h('span', null, h('i', { class: 'k-in' }), mode === 'day' ? 'kcal eaten' : 'average kcal per day'),
    anyOver ? h('span', null, h('i', { class: 'k-over' }), 'the part over target') : null,
    h('span', null, h('i', { class: 'k-line' }), 'daily target'));
  const title = mode === 'day' ? 'Calories each day' : mode === 'week' ? 'Daily average, week by week' : 'Daily average, month by month';
  const sub = mode === 'day' ? '' : 'Each column averages the days you logged.' + (folded ? ' The slashes mark a stretch with nothing logged.' : '');
  body.append(figure('daily', title, sub,
    plot => drawColumns(plot, cols, { label: title + ', ' + cols.length + ' columns. Use the arrow keys to read each one.' }),
    () => tableOf([mode === 'day' ? 'Day' : mode === 'week' ? 'Week of' : 'Month', mode === 'day' ? 'kcal' : 'kcal / day', 'Target', 'Difference', mode === 'day' ? '' : 'Days'].filter(Boolean),
      cols.filter(b => b.gap || b.v != null).map(b => b.gap ? [b.tip, '–', '–', '–'].concat(mode === 'day' ? [] : ['0']) :
        [b.tip.replace('Week of ', ''), fmt(b.v), fmt(b.target), (b.v - b.target > 0 ? '+' : '') + fmt(b.v - b.target)].concat(mode === 'day' ? [] : [String(b.n)]))),
    legend));
  body.append(h('div', { class: 'mid' }));

  /* weekday pattern */
  const wd = Array.from({ length: 7 }, () => ({ n: 0, sum: 0 }));
  for (const d of inRange) { const i = (parseD(d).getDay() + 6) % 7; wd[i].n++; wd[i].sum += totals.get(d); }
  const wdb = wd.map((x, i) => ({ label: WD[(i + 1) % 7], tip: WDL[(i + 1) % 7] + 's', v: x.n ? x.sum / x.n : null, target: tavg, note: x.n + (x.n === 1 ? ' day' : ' days') }));
  body.append(figure('weekday', 'By day of the week', 'Average on each weekday, against your average target.',
    plot => drawColumns(plot, wdb, { height: 190, caps: true, label: 'Average calories by weekday. Use the arrow keys to read each one.' }),
    () => tableOf(['Weekday', 'kcal / day', 'Days'], wdb.filter(b => b.v != null).map(b => [b.tip, fmt(b.v), b.note.replace(/ days?/, '')])),
    h('div', { class: 'legend' }, h('span', null, h('i', { class: 'k-in' }), 'average kcal'), wdb.some(b => b.v > b.target) ? h('span', null, h('i', { class: 'k-over' }), 'the part over target') : null, h('span', null, h('i', { class: 'k-line' }), 'average target'))));
  body.append(h('div', { class: 'mid' }));

  /* where the calories came from */
  const foods = new Map();
  for (const ym in S.months) { const stt = S.months[ym]; for (const dd in stt.days) { const d = ym + '-' + dd; if (d < start || d > end) continue; for (const e of stt.days[dd]) { const k = fold(e.f); let f = foods.get(k); if (!f) foods.set(k, f = { n: e.f, k: 0, c: 0 }); f.k += e.k; f.c++; } } }
  const top = [...foods.values()].sort((a, b) => b.k - a.k).slice(0, 8), max = top.length ? top[0].k : 1;
  const hb = h('div', { class: 'hbars' });
  for (const f of top) hb.append(h('div', { class: 'hb' }, h('span', { class: 'hb-name', text: f.n, title: f.n }),
    h('span', { class: 'hb-track' }, h('span', { class: 'hb-bar', style: 'width:' + Math.max(1, f.k / max * 100).toFixed(1) + '%' })),
    h('span', { class: 'hb-val', text: fmt(f.k) + ' · ' + f.c + '×' })));
  body.append(h('figure', { class: 'fig' }, h('figcaption', { class: 'fig-title', text: 'Where the calories came from' }), h('p', { class: 'fig-sub', text: 'Total kcal and times logged, top ' + top.length + ' of ' + foods.size + ' foods (' + Math.round(top.reduce((s, f) => s + f.k, 0) / sum * 100) + '% of everything in this range).' }), hb));
}

/* -------------------------------------------------------------- history view */
function renderHistory() {
  const body = $('#history-body');
  if (!S.ready) return;
  const open = new Set([...body.querySelectorAll('details[open]')].map(d => d.dataset.ym));
  body.textContent = '';
  const yms = Object.keys(S.months).filter(ym => Object.keys(S.months[ym].days).length).sort().reverse();
  if (!yms.length) { body.append(h('p', { class: 'empty', text: 'Every day you log is kept here, month by month.' })); return; }
  const wrap = h('div', { class: 'months' });
  for (const ym of yms) {
    const st = S.months[ym], dds = Object.keys(st.days).sort().reverse();
    const total = dds.reduce((s, dd) => s + sumK(st.days[dd]), 0), p = ym.split('-').map(Number);
    const list = h('ul', { class: 'days' });
    const fill = () => {
      if (list.childNodes.length) return;
      for (const dd of dds) {
        const d = ym + '-' + dd, t = sumK(st.days[dd]), over = t > targetFor(d), pd = parseD(d);
        list.append(h('li', null, h('button', { class: 'day-row', type: 'button', 'aria-label': 'Open ' + dayShort(d) + ', ' + fmt(t) + ' kcal' + (over ? ', over target' : ''), onclick: () => { setView('today'); setDate(d); window.scrollTo(0, 0); } },
          h('span', { class: 'd-date', text: WD[pd.getDay()] + ' ' + pd.getDate() }),
          h('span', { class: 'd-foods', text: st.days[dd].map(e => e.f).join(', ') }),
          h('span', { class: 'd-total' }, over ? h('i', { class: 'ov', title: 'Over target' }) : null, fmt(t)))));
      }
    };
    const det = h('details', { 'data-ym': ym, open: open.has(ym) },
      h('summary', null, h('span', { class: 'm-name', text: MONL[p[1] - 1] + ' ' + p[0] }), h('span', { class: 'm-meta', text: dds.length + (dds.length === 1 ? ' day' : ' days') }), h('span', { class: 'm-avg', text: fmt(total / dds.length) + ' /day' })),
      list);
    det.addEventListener('toggle', () => { if (det.open) fill(); });
    if (det.open) fill();
    wrap.append(det);
  }
  body.append(wrap, h('p', { class: 'foot', text: 'A square marks a day that ran over its target. Open any day to change it.' }));
}

/* ------------------------------------------------------------ export, import */
function wholeCsv() {
  const extra = [];
  for (const ym in S.months) for (const c of S.months[ym].extra) if (!extra.includes(c)) extra.push(c);
  const lines = [COLS.concat(extra).map(csvCell).join(',')];
  for (const ym of Object.keys(S.months).sort()) lines.push(...csvLines(ym, S.months[ym].days, extra));
  return { text: lines.join('\n') + '\n', rows: lines.length - 1 };
}
function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportCsv() {
  const c = wholeCsv();
  if (!c.rows) { toast('There is nothing to export yet.'); return; }
  saveFile('calorie-log-' + today() + '.csv', c.text, 'text/csv');
  toast('Exported ' + fmt(c.rows) + ' entries.');
}
/* Import takes the export format (or any CSV with date, food and kcal columns). Rows whose id is
   already in the log replace that entry; rows identical to an existing entry are skipped. */
function readImport(text) {
  const p = parseLog(text, null);
  if (p.bad) return { bad: p.bad };
  const add = [];
  let same = 0, upd = 0;
  for (const r of p.list) {
    const cur = dayItems(r.date), byId = cur.find(e => e.i === r.e.i);
    const twin = cur.find(e => fold(e.f) === fold(r.e.f) && e.k === r.e.k && (e.t || '') === (r.e.t || ''));
    if (byId && byId.f === r.e.f && byId.k === r.e.k && (byId.t || '') === (r.e.t || '') && (byId.n || '') === (r.e.n || '')) { same++; continue; }
    if (!byId && twin) { same++; continue; }
    if (r.date > addDays(today(), 2)) return { bad: 'the date ' + r.date + ' is in the future' };       /* a day ahead can be another device's time zone */
    if (byId) upd++;
    add.push(r);
  }
  return { add, same, upd, extra: p.extra };
}
function renderImport() {
  const box = $('#import-card');
  box.textContent = '';
  const imp = S.imp;
  if (!imp) return;
  if (imp.bad) { box.append(h('div', { class: 'imp' }, h('span', null, h('b', { text: 'That file can’t be imported. ' }), 'The logbook stopped at ' + imp.bad + '.'), h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost small', type: 'button', text: 'Close', onclick: () => { S.imp = null; renderImport(); } })))); return; }
  const n = imp.add.length, dates = imp.add.map(r => r.date).sort();
  const text = n ? fmt(n) + (n === 1 ? ' entry' : ' entries') + ' to bring in, from ' + dayShort(dates[0]) + ' to ' + dayShort(dates[n - 1]) + '.' + (imp.upd ? ' ' + fmt(imp.upd) + ' of them replace entries with the same id.' : '') + (imp.same ? ' ' + fmt(imp.same) + ' already in your log are skipped.' : '')
    : 'Nothing new in that file. All ' + fmt(imp.same) + ' entries are already in your log.';
  box.append(h('div', { class: 'imp' }, h('span', { text }), h('div', { class: 'btn-row' },
    n ? h('button', { class: 'btn small', type: 'button', text: 'Import ' + fmt(n), onclick: doImport }) : null,
    h('button', { class: 'btn ghost small', type: 'button', text: n ? 'Cancel' : 'Close', onclick: () => { S.imp = null; renderImport(); } }))));
}
function doImport() {
  const imp = S.imp;
  if (!imp || !imp.add) return;
  const touched = new Map();                                    /* month -> the extra columns its imported rows use */
  let done = 0;
  for (const r of imp.add) {
    const st = mstate(ymOf(r.date));
    if (st.bad) continue;
    done++;
    if (!touched.has(st)) touched.set(st, new Set());
    for (const c in (r.e.x || {})) touched.get(st).add(c);
    opPut(st, ddOf(r.date), r.e, null, 'import');
  }
  for (const [st, used] of touched) {
    for (const c of (imp.extra || [])) if (used.has(c) && !st.extra.includes(c)) st.extra.push(c);
    refresh(st); saveMonth(st);
  }
  S.imp = null; S.usualList = null;
  renderImport(); setSync(); render(); requestSync(300);
  const skipped = imp.add.length - done;
  toast('Imported ' + fmt(done) + (done === 1 ? ' entry.' : ' entries.') + (skipped ? ' ' + fmt(skipped) + ' left out: their month can’t be changed right now.' : ''));
}

/* ---------------------------------------------------------- deleting history */
/* What a clean-out would remove: everything, or every day before a date. Months that are locked,
   or waiting on a decision because their file went missing, are left alone. */
function clearScope(c) {
  const out = { n: 0, days: 0, first: '', last: '', ids: [], synced: false, skipped: 0, invalid: false };
  if (c.scope === 'before' && !(/^\d{4}-\d\d-\d\d$/.test(c.before) && dstr(parseD(c.before)) === c.before)) { out.invalid = true; return out; }
  const before = c.scope === 'before' ? c.before : null;
  for (const ym of Object.keys(S.months).sort()) {
    const st = S.months[ym];
    const dds = Object.keys(st.days).filter(dd => st.days[dd].length && (!before || ym + '-' + dd < before)).sort();
    if (!dds.length) continue;
    if (st.bad) { out.skipped++; continue; }
    if (st.sha) out.synced = true;
    out.days += dds.length;
    for (const dd of dds) for (const e of st.days[dd]) { out.n++; out.ids.push([ym, dd, e.i, e.f]); }
    if (!out.first) out.first = ym + '-' + dds[0];
    out.last = ym + '-' + dds[dds.length - 1];
  }
  return out;
}
function renderClear() {
  const box = $('#clear-card'), c = S.clear;
  box.textContent = '';
  $('#clear-btn').setAttribute('aria-expanded', c ? 'true' : 'false');
  if (!c) return;
  const go = h('button', { class: 'btn small', id: 'clear-go', type: 'button' });
  const scope = h('select', { class: 'field', id: 'clear-scope' },
    h('option', { value: 'all', text: 'Everything', selected: c.scope === 'all' }),
    h('option', { value: 'before', text: 'Only days before a date', selected: c.scope === 'before' }));
  scope.addEventListener('change', () => { c.scope = scope.value; renderClear(); $('#clear-scope').focus(); });
  const date = h('input', { class: 'field', id: 'clear-before', type: 'date', value: c.before, max: today() });
  date.addEventListener('change', () => { c.before = date.value; disarm(go); updateClear(); });
  /* The first tap fixes what will go; the second deletes exactly that, whatever has arrived in between. */
  go.addEventListener('click', () => {
    if (!go.armed) {
      go.plan = clearScope(c);
      if (go.plan.n !== go.shown) { updateClear(); return; }               /* the log changed under the card: show the new count first */
      if (!go.plan.n) return;
    }
    twice(go, 'Tap again to delete', () => doClear(go.plan), updateClear);
  });
  box.append(h('div', { class: 'imp' },
    h('b', { text: 'Delete history' }),
    h('label', null, 'What to delete', scope),
    c.scope === 'before' ? h('label', null, 'Delete days before', date) : null,
    h('span', { id: 'clear-sum', 'aria-live': 'polite' }),
    h('div', { class: 'btn-row' }, go, h('button', { class: 'btn ghost small', id: 'clear-cancel', type: 'button', text: 'Cancel', onclick: () => { disarm(go); S.clear = null; renderClear(); $('#clear-btn').focus(); } }))));
  updateClear();
}
/* The count on the card follows the log, which can change while the card is open (a sync, another device). */
function updateClear() {
  const c = S.clear, sum = $('#clear-sum'), go = $('#clear-go');
  if (!c || !sum || !go || go.armed) return;                    /* while armed the card keeps saying what the first tap fixed */
  const sc = clearScope(c), on = configured(), repo = S.cfg.owner + '/' + S.cfg.repo;
  const count = fmt(sc.n) + (sc.n === 1 ? ' entry' : ' entries');
  let text;
  if (sc.invalid) text = 'Pick a date.';
  else if (!sc.n) text = 'There is nothing to delete' + (c.scope === 'before' ? ' before ' + dayShort(c.before) : '') + '.';
  else text = 'This deletes ' + count + ' on ' + fmt(sc.days) + (sc.days === 1 ? ' day' : ' days') + ' (' + (sc.first === sc.last ? dayShort(sc.first) : dayShort(sc.first) + ' to ' + dayShort(sc.last)) + ') from this device'
    + (on ? ' and from ' + repo + '. ' : sc.synced ? ' now, and from ' + repo + ' when you connect again. ' : '. ')
    + (on || sc.synced ? 'Export first if you want to keep a copy. Earlier versions of the files also stay in that repository’s commit history on GitHub.' : 'Nothing is backed up anywhere else, so export first if you want a copy.');
  if (sc.skipped) text += ' ' + sc.skipped + (sc.skipped === 1 ? ' month that can’t be changed right now is' : ' months that can’t be changed right now are') + ' left alone.';
  sum.textContent = text;
  go.textContent = sc.n ? 'Delete ' + count : 'Delete';
  go.disabled = !sc.n; go.shown = sc.n;
}
function doClear(plan) {
  if (!S.clear || !plan) return;
  const touched = new Set();
  let n = 0;
  for (const [ym, dd, id, name] of plan.ids) {
    const st = S.months[ym];
    if (!st || st.bad || !hasId(st.days[dd], id)) continue;                /* removed or locked since the first tap */
    opDel(st, dd, id, name); touched.add(st); n++;
  }
  for (const st of touched) { refresh(st); saveMonth(st); }
  S.clear = null; S.edit = null; S.usualList = null; S.range = null;
  renderClear(); setSync(); render(); requestSync(300);
  $('#clear-btn').focus();
  toast('Deleted ' + fmt(n) + (n === 1 ? ' entry.' : ' entries.'));
}

/* ------------------------------------------------------------- settings view */
function parseRepo(text) {
  const m = /(?:github\.com[/:])?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(String(text).trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}
function renderSettings() {
  const on = configured(), n = pendingCount(), count = entryCount();
  const det = $('#sync-detail');
  det.textContent = '';
  if (!on) det.append('Not connected. Entries are kept in this browser on this device only' + (count ? ' (' + fmt(count) + ' so far)' : '') + '. Connect a private GitHub repository to back them up and share them between your phone and computer.');
  else if (S.syncErr) det.append(h('b', { text: ({ offline: 'Offline. ', rate: 'Sync is paused. ', public: 'This repository is public. ', changed: 'This is a different repository. ' })[S.syncErr.code] || 'Sync needs attention. ' }), explain(S.syncErr));
  else det.append(h('b', { text: 'Connected to ' + S.cfg.owner + '/' + S.cfg.repo + '. ' }), pendingCount(true) ? 'Changes are being saved.' : n ? fmt(n) + (n === 1 ? ' change is' : ' changes are') + ' waiting, because the month ' + (n === 1 ? 'it belongs' : 'they belong') + ' to can’t be written right now.' : 'Everything is saved' + (S.lastSync ? ', last checked at ' + clock(S.lastSync) : '') + '. Each change becomes a commit there, in files like log/' + ymOf(today()) + '.csv.');
  const bad = Object.keys(S.months).filter(ym => S.months[ym].bad).sort();
  if (bad.length) det.append(h('span', { style: 'display:block;margin-top:6px' }, h('b', { text: 'Locked: ' }), bad.map(ym => 'log/' + ym + '.csv (' + S.months[ym].bad + ')').join('; ') + '. Fix the file on GitHub and sync again; the logbook will not write to a file it cannot read exactly.'));
  const repo = $('#gh-repo'), tok = $('#gh-token');
  if (document.activeElement !== repo && !repo.value && on) repo.value = S.cfg.owner + '/' + S.cfg.repo;
  tok.placeholder = on ? 'Saved. Paste a new one to replace it.' : 'github_pat_…';
  $('#gh-connect').textContent = on ? 'Save' : 'Connect';
  $('#sync-now').hidden = !on;
  $('#gh-disconnect').hidden = !on;
  $('#data-detail').textContent = fmt(count) + (count === 1 ? ' entry is' : ' entries are') + ' on this device' + (S.mem ? ', but this browser is not keeping data between visits (a private window does that)' : '') + '. Export saves everything as one CSV, and Import reads the same format back. Delete history removes entries everywhere' + (on ? ', your repo included' : '') + '; Erase only clears this browser.';
  updateClear();
  $('#about').textContent = 'Version ' + VERSION + '. This page loads only its own files. The only place it talks to is GitHub, to read and write your data repository. Nothing else leaves this device.';
}
async function connect() {
  const msg = $('#gh-msg'), say = t => { msg.textContent = t; };
  const pr = parseRepo($('#gh-repo').value), token = $('#gh-token').value.trim() || S.cfg.token;
  S.switching = null; renderSwitch();
  if (!pr) { say('Write the repository as yourname/repository.'); return; }
  if (!token) { say('Paste the access token for that repository.'); return; }
  if (paused()) { say('GitHub asked the logbook to wait until ' + clock(S.hold) + '. Nothing was saved here; tap this button again after that.'); return; }
  const trial = Object.assign({}, S.cfg, pr, { token });
  say('Checking with GitHub…');
  let res;
  try { res = await ghFetch('GET', '', null, false, trial); }
  catch (e) { say('GitHub can’t be reached right now. Check your connection and try again.'); return; }
  if (res.status === 401) { say('GitHub did not accept that token. Copy it again from GitHub; it usually starts with github_pat_.'); return; }
  if (res.status === 404) { say('GitHub can’t find ' + pr.owner + '/' + pr.repo + ' with this token. Check the name, and that the token’s repository access includes it.'); return; }
  if (!res.ok) {
    const f = await ghFail(res);
    if (f.code === 'rate') { pauseFor(f); setSync(); say('GitHub is limiting requests for now. Nothing was saved here; tap this button again after ' + clock(S.hold) + '.'); } else say(f.message.replace(/\.+$/, '') + '.');
    return;
  }
  const info = await res.json();
  if (info.private === false) { say('That repository is public, so anyone could read your log. Make it private on GitHub (Settings, General, Danger Zone, Change visibility), then connect again.'); return; }
  if (syncing) await syncing;                                                /* let a sync with the old settings finish first */
  /* A different repository from the one this device has been syncing with (by GitHub's own id for
     it, so a rename or different capitals do not count): what is held here is neither copied into
     it nor dropped until the owner says which. */
  const held = heldFromRepo(), was = S.cfg.owner + '/' + S.cfg.repo;
  const other = held > 0 && (S.cfg.repoId && info.id ? info.id !== S.cfg.repoId : !!S.cfg.owner && was.toLowerCase() !== (pr.owner + '/' + pr.repo).toLowerCase());
  if (other) { S.switching = { trial, info, held, was }; say(''); renderSwitch(); return; }
  await useRepo(trial, info, '');
}
/* mode: '' (the same repository as before, or nothing held), 'copy' or 'drop' */
async function useRepo(trial, info, mode) {
  const say = t => { $('#gh-msg').textContent = t; };
  if (syncing) await syncing;
  if (mode) {
    for (const ym in S.months) {
      const st = S.months[ym];
      st.ops = joinOps(st.sending, st.ops); st.sending = null;
      if (mode === 'copy') reupload(st);                                     /* every entry held here is queued; the sync adds the ones that repository lacks */
      else { dropRestores(st.ops, null); st.remote = {}; st.sha = null; st.prev = null; st.bad = null; st.extra = extrasWith(st, []); }      /* changes not yet sent are kept */
      st.gone = false;                                                       /* asked for, so not reported as a month put back */
      refresh(st); saveMonth(st);
    }
    S.putBack = { months: 0, entries: 0 };
    /* The daily targets go the same way: copied along, or dropped for whatever that repository has. A target change not yet sent is kept either way. */
    if (mode === 'copy') S.targetsDirty = S.targetsDirty || S.targets.some(t => t.from !== '2000-01-01');
    else if (!S.targetsDirty) S.targets = [{ from: '2000-01-01', k: 2000 }];
    S.settingsSha = null;
    saveSettings();
    S.usualList = null; S.range = null; S.edit = null;
  }
  S.switching = null; renderSwitch();
  S.cfg = Object.assign({}, trial, { branch: info.default_branch || 'main', repoId: info.id || 0 });
  await keep('cfg', S.cfg);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $('#gh-token').value = '';
  S.syncErr = null; S.lastPull = 0;
  say('Connected. Syncing…');
  setSync(); render();
  await sync(true);
  say(S.syncErr ? explain(S.syncErr) : 'Connected. ' + fmt(entryCount()) + ' entries are in sync with ' + S.cfg.owner + '/' + S.cfg.repo + '.');
}
function renderSwitch() {
  const box = $('#switch-card'), w = S.switching;
  box.textContent = '';
  if (!w) return;
  const to = w.trial.owner + '/' + w.trial.repo, count = fmt(w.held) + (w.held === 1 ? ' entry' : ' entries');
  const copy = h('button', { class: 'btn small', id: 'switch-copy', type: 'button', text: 'Copy them into it', onclick: () => useRepo(w.trial, w.info, 'copy') });
  const drop = h('button', { class: 'btn ghost small', id: 'switch-drop', type: 'button', text: 'Remove them from this device' });
  drop.addEventListener('click', () => twice(drop, 'Tap again to remove', () => useRepo(w.trial, w.info, 'drop')));
  box.append(h('div', { class: 'imp', role: 'group', 'aria-label': 'A different repository' },
    h('b', { text: 'That is a different repository.' }),
    h('span', { id: 'switch-sum' }, 'This device holds ' + count + ' from ' + (w.was === to ? 'the repository that used to have this name' : w.was) + '. Nothing has changed yet. Copy them into ' + to + ', or remove them from this device and keep only what that repository holds? Removing can’t be undone here; export first if this may be the only copy. Changes not yet sent are kept either way.'),
    h('div', { class: 'btn-row' }, copy, drop, h('button', { class: 'btn ghost small', id: 'switch-cancel', type: 'button', text: 'Cancel', onclick: () => { disarm(drop); S.switching = null; renderSwitch(); $('#gh-msg').textContent = 'Nothing was changed.'; } }))));
  copy.focus();
}
async function disconnect() {
  const n = pendingCount();
  S.cfg = Object.assign({}, S.cfg, { token: '' });
  await keep('cfg', S.cfg);
  S.syncErr = null;
  $('#gh-msg').textContent = 'Disconnected. The token is removed from this browser; your entries stay on this device' + (n ? ', including ' + fmt(n) + ' not yet sent' : '') + '.';
  setSync(); render();
}
function erase() {
  const btn = $('#erase-btn'), n = pendingCount();
  if (!btn.armed) $('#data-msg').textContent = 'This removes the log and the token from this browser. ' + (configured() ? (n ? fmt(n) + ' unsent ' + (n === 1 ? 'change' : 'changes') + ' would be lost; the rest stays in your GitHub repo.' : 'The copy in your GitHub repo is not touched.') : 'Nothing is backed up anywhere else, so export first.');
  twice(btn, 'Tap again to erase', async () => { erasing = true; await kv.clear(); location.reload(); }, () => { $('#data-msg').textContent = ''; });
}
async function checkUpdate() {
  try {
    if (navigator.serviceWorker) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
  } catch (e) {}
  location.reload();
}

/* --------------------------------------------------------------------- wiring */
function wire() {
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => setView(t.dataset.view));
  $('#sync').addEventListener('click', () => { if (configured() && !S.syncErr) sync(true); else setView('settings'); });
  $('#prev-day').addEventListener('click', () => setDate(addDays(S.date, -1)));
  $('#next-day').addEventListener('click', () => setDate(addDays(S.date, 1)));
  $('#go-today').addEventListener('click', () => setDate(today()));
  $('#jump-date').addEventListener('change', ev => { const v = ev.target.value; if (/^\d{4}-\d\d-\d\d$/.test(v)) setDate(v); });
  $('#add-form').addEventListener('submit', ev => { ev.preventDefault(); submitAdd(); });
  const food = $('#food');
  food.addEventListener('input', () => { S.sugIdx = -1; hint(''); renderSugs(); });
  food.addEventListener('keydown', ev => {
    const n = S.sugList.length;
    if (ev.key === 'ArrowDown' && n) { ev.preventDefault(); S.sugIdx = (S.sugIdx + 1) % n; renderSugs(); }
    else if (ev.key === 'ArrowUp' && n) { ev.preventDefault(); S.sugIdx = (S.sugIdx - 1 + n) % n; renderSugs(); }
    else if (ev.key === 'Enter' && S.sugIdx >= 0 && S.sugList[S.sugIdx]) { ev.preventDefault(); pickSug(S.sugList[S.sugIdx]); }
    else if (ev.key === 'Escape') { S.sugIdx = -1; $('#sugs').hidden = true; }
  });
  $('#target-cancel').addEventListener('click', () => { $('#target-form').hidden = true; });
  $('#target-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const k = Math.round(calc($('#target-input').value));
    if (!isFinite(k) || k < 500 || k > 10000) { toast('Enter a daily target between 500 and 10,000 kcal.'); return; }
    const now = today(), last = S.targets[S.targets.length - 1];
    if (last && last.from === now) last.k = k; else if (!last || last.k !== k) S.targets.push({ from: now, k });
    $('#target-form').hidden = true;
    S.targetsDirty = true; saveSettings();
    setSync(); render(); requestSync(300);
    toast('Target set to ' + fmt(k) + ' kcal from today. Earlier days keep the target they had.');
  });
  for (const b of document.querySelectorAll('.range')) b.addEventListener('click', () => { S.range = b.dataset.range; renderTrends(); });
  $('#export-btn').addEventListener('click', exportCsv);
  $('#export-btn2').addEventListener('click', exportCsv);
  $('#import-btn').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { S.imp = readImport(String(fr.result)); renderImport(); };
    fr.onerror = () => { $('#data-msg').textContent = 'That file could not be read.'; };
    fr.readAsText(f);
  });
  $('#clear-btn').addEventListener('click', () => { S.clear = S.clear ? null : { scope: 'all', before: today() }; renderClear(); });
  $('#erase-btn').addEventListener('click', erase);
  $('#update-btn').addEventListener('click', checkUpdate);
  $('#gh-form').addEventListener('submit', ev => { ev.preventDefault(); connect(); });
  $('#sync-now').addEventListener('click', async () => { $('#gh-msg').textContent = 'Syncing…'; await sync(true); $('#gh-msg').textContent = S.syncErr ? explain(S.syncErr) : 'Up to date.'; });
  $('#gh-disconnect').addEventListener('click', disconnect);
  wide.addEventListener('change', render);
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v)) setView(v, false); });
  window.addEventListener('online', () => { setSync(); requestSync(200, true); });
  window.addEventListener('offline', setSync);
  if (window.ResizeObserver) {
    let lastW = 0;
    new ResizeObserver(es => { const w = Math.round(es[0].contentRect.width); if (w === lastW) return; lastW = w; clearTimeout(trendsTimer); trendsTimer = setTimeout(() => { if (!$('#view-trends').hidden && S.ready) renderTrends(); }, 120); }).observe($('#view-trends'));
  }
  let seenDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const now = today();
    if (now !== seenDay) { const wasToday = S.date === seenDay; seenDay = now; if (wasToday) setDate(now); else render(); }
    if (configured() && (Date.now() - S.lastPull > 60000 || pendingCount())) requestSync(100, true);
  });
}

async function boot() {
  const d = await idb();
  S.mem = !d;
  for (const [key, val] of await kv.all()) {
    if (!val) continue;
    if (key === 'cfg') {
      for (const k of ['owner', 'repo', 'branch', 'token']) if (typeof val[k] === 'string') S.cfg[k] = val[k];
      if (typeof val.repoId === 'number') S.cfg.repoId = val.repoId;
      if (Object.keys(val).some(k => !(k in S.cfg))) keep('cfg', S.cfg);      /* an earlier version kept more here; it is dropped */
    }
    else if (key === 'settings') { S.targets = cleanTargets(val.targets); S.settingsSha = val.sha || null; S.targetsDirty = !!val.dirty; }
    else if (key === 'meta') { S.lastSync = val.lastSync || 0; S.hold = Number(val.hold) || 0; S.strikes = Number(val.strikes) || 0; }
    else if (typeof key === 'string' && key.startsWith('month:')) {
      const st = mstate(key.slice(6));
      st.remote = cleanDays(val.remote); st.sha = val.sha || null; st.extra = Array.isArray(val.extra) ? val.extra : []; st.bad = val.bad || null; st.gone = !!val.gone;
      st.ops = unpackOps(val.ops);
      refresh(st);
    }
  }
  S.ready = true;
  if (paused()) S.syncErr = { code: 'rate', message: '' };                 /* still inside a pause GitHub asked for */
  if (S.mem) showNotice('This browser is not keeping data between visits.', 'A private window does that. Connect your GitHub repo in Settings so entries are saved there.');
  setSync(); render();
  if (configured()) sync(true);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

const v0 = location.hash.slice(1);
if (VIEWS.includes(v0)) S.view = v0;
wire();
setSync();
render();
boot();
})();
