/* Home 3D. App shell only: house data is fetched from a private GitHub repo with a
   read-only token kept in this browser's localStorage (or embedded in the offline copy). */
'use strict';
const API = 'https://api.github.com';
const DEFAULT_REPO = 'braydendueck/home-3d-data';
const FILE = 'tasks.json';
const LS = { token: 'h3d.token', repo: 'h3d.repo', cache: 'h3d.cache', done: 'h3d.done', hinted: 'h3d.hinted', fetched: 'h3d.fetched' };
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Home+3D+phone&description=Home+3D+app%3A+read-only+tasks.json+in+home-3d-data+only&target_name=braydendueck&expires_in=365&contents=read';
const EMBED = window.H3D_EMBED || null;
const DAY = 864e5;
const SEV = { red: 3, orange: 2, yellow: 1, clear: 0, watch: -1 };
const STLABEL = { red: 'Urgent or overdue', orange: 'Due soon', yellow: 'To do', clear: 'Clear' };
const COL = { red: '#e5484d', orange: '#f2780c', yellow: '#e8b400', clear: '#98a2ae' };

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  token: localStorage.getItem(LS.token) || '',
  repo: localStorage.getItem(LS.repo) || DEFAULT_REPO,
  data: null, view: 'home', sel: null, showAllNeeds: false, level: 'all',
  done: JSON.parse(localStorage.getItem(LS.done) || '{}'),
};

/* ---------------- dates & status ---------------- */
function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(d, withYear) { return `${MON[d.getMonth()]} ${d.getDate()}${withYear ? ', ' + d.getFullYear() : ''}`; }
function days(a, b) { return Math.round((b - a) / DAY); }
function inDays(n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; }

/* Concrete windows for years around today. w = ["MM-DD","MM-DD",{years|fromYear}] */
function concreteWindows(ws, t0) {
  const out = [], Y = t0.getFullYear();
  for (const w of ws) {
    const opt = w[2] || {};
    for (let y = Y - 1; y <= Y + 1; y++) {
      if (opt.years && !opt.years.includes(y)) continue;
      if (opt.fromYear && y < opt.fromYear) continue;
      const [fm, fd] = w[0].split('-').map(Number), [tm, td] = w[1].split('-').map(Number);
      const start = new Date(y, fm - 1, fd);
      const end = new Date(y + (tm < fm || (tm === fm && td < fd) ? 1 : 0), tm - 1, td);
      out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/* Returns {st, txt, due?} for one task on date t0. */
function taskStatus(t, t0 = today(), D = S.data) {
  const soon = D?.soonDays ?? 14, grace = D?.overdueGraceDays ?? 30;
  const s = t.schedule || { k: 'asneeded' };
  const rec = S.done[t.id] || {};
  const done = rec.done ? parseISO(rec.done) : null;
  let r;
  if (s.k === 'watch') return { st: 'watch', txt: 'Watch-out. Only when there is a real reason.' };
  if (t.urgent && !done) {
    r = rec.booked ? { st: 'orange', txt: `Booked ${fmt(parseISO(rec.booked))}. Not done yet.` } : { st: 'red', txt: t.urgent };
    return r;
  }
  switch (s.k) {
    case 'asneeded': r = { st: 'clear', txt: 'As needed' }; break;
    case 'cond': r = { st: 'clear', txt: s.if }; break;
    case 'season': {
      const ws = concreteWindows(s.w, t0), cur = ws.find(w => w.start <= t0 && t0 <= w.end), nx = ws.find(w => w.start > t0);
      r = { st: 'clear', txt: cur ? `In season until ${fmt(cur.end)}. As needed.` : nx ? `As needed from ${fmt(nx.start)}` : 'As needed' };
      break;
    }
    case 'once': {
      if (done) { r = { st: 'clear', txt: `Done ${fmt(done)}` }; break; }
      if (s.by) {
        const by = parseISO(s.by), n = days(t0, by);
        if (n < 0) r = s.noRed ? { st: 'orange', txt: `Past the target of ${fmt(by)}. Still to do.`, due: by } : t.verdict === 'E' ? { st: 'red', txt: `Overdue. Target was ${fmt(by)}.`, due: by } : { st: 'yellow', txt: `Past the target of ${fmt(by)}`, due: by };
        else if (n <= soon) r = { st: 'orange', txt: `Due by ${fmt(by)} (${inDays(n)})`, due: by };
        else r = { st: 'yellow', txt: `Due by ${fmt(by)}`, due: by };
      } else if (s.hot) {
        const ws = concreteWindows(s.hot, t0), cur = ws.find(w => w.start <= t0 && t0 <= w.end), nx = ws.find(w => w.start > t0);
        r = cur ? { st: 'orange', txt: `Book it by ${fmt(cur.end)}`, due: cur.end } : { st: 'yellow', txt: nx ? `To do. Book it from ${fmt(nx.start, nx.start.getFullYear() !== t0.getFullYear())}.` : 'To do once' };
      } else r = { st: 'yellow', txt: 'To do once' };
      break;
    }
    case 'window': {
      const ws = concreteWindows(s.w, t0);
      const cur = ws.find(w => w.start <= t0 && t0 <= w.end);
      const nx = ws.find(w => w.start > t0);
      const prev = ws.filter(w => w.end < t0).pop();
      if (cur) {
        if (done && done >= cur.start) { r = { st: 'clear', txt: `Done ${fmt(done)}${nx ? `. Next from ${fmt(nx.start, nx.start.getFullYear() !== t0.getFullYear())}` : ''}` }; break; }
        const n = days(t0, cur.end);
        r = s.inWindow === 'orange' ? { st: 'orange', txt: `This month: do by ${fmt(cur.end)} (${inDays(n)})`, due: cur.end } : n <= soon ? { st: 'orange', txt: `Due by ${fmt(cur.end)} (${inDays(n)})`, due: cur.end } : { st: 'yellow', txt: `Do by ${fmt(cur.end)}`, due: cur.end };
        break;
      }
      if (s.outside === 'yellow' && nx) { r = { st: 'yellow', txt: `Next: ${fmt(nx.start, nx.start.getFullYear() !== t0.getFullYear())} to ${fmt(nx.end)}`, due: nx.end }; break; }
      if (prev && days(prev.end, t0) <= grace && !(done && done >= prev.start) && t.verdict === 'E') {
        r = { st: 'red', txt: `Overdue. It was due by ${fmt(prev.end)}.`, due: prev.end }; break;
      }
      if (nx) {
        const ns = days(t0, nx.start), ne = days(t0, nx.end);
        if (ne <= soon) r = { st: 'orange', txt: `Due ${fmt(nx.start)} to ${fmt(nx.end)} (${inDays(ne)})`, due: nx.end };
        else if (ns <= soon) r = { st: 'yellow', txt: `Starts ${fmt(nx.start)}, do by ${fmt(nx.end)}`, due: nx.end };
        else r = { st: 'clear', txt: `Next: ${fmt(nx.start, nx.start.getFullYear() !== t0.getFullYear())} to ${fmt(nx.end)}` };
      } else r = { st: 'clear', txt: done ? `Done ${fmt(done)}` : 'Nothing scheduled' };
      break;
    }
    case 'every': {
      const per = s.days, soonE = Math.min(soon, Math.max(3, Math.round(per / 4)));
      if (!done) { r = { st: 'yellow', txt: `Not logged yet. Every ${everyTxt(per)}.` }; break; }
      const nd = new Date(done.getTime() + per * DAY), n = days(t0, nd);
      if (n < 0) r = t.verdict === 'E' ? { st: 'red', txt: `Overdue since ${fmt(nd)}`, due: nd } : { st: 'yellow', txt: `Was due ${fmt(nd)}`, due: nd };
      else if (n <= soonE) r = { st: 'orange', txt: `Due ${fmt(nd)} (${inDays(n)})`, due: nd };
      else r = { st: 'clear', txt: `Done ${fmt(done)}. Next ${fmt(nd)}.` };
      break;
    }
    default: r = { st: 'clear', txt: '' };
  }
  if (t.verdict === 'O' && !t.noCap && (r.st === 'red' || r.st === 'orange')) r = { ...r, st: 'yellow', txt: r.txt + ' (optional)' };
  return r;
}
function everyTxt(n) { return n === 30 ? 'month' : n === 60 ? '2 months' : n === 90 ? '3 months' : n === 182 ? '6 months' : n === 365 ? 'year' : `${n} days`; }

function computeAll(t0 = today()) {
  const D = S.data; if (!D) return null;
  const byArea = {};
  for (const a of D.areas) byArea[a.id] = { area: a, st: 'clear', tasks: [], counts: { red: 0, orange: 0, yellow: 0 } };
  for (const t of D.tasks) {
    const r = taskStatus(t, t0, D), A = byArea[t.area]; if (!A) continue;
    A.tasks.push({ t, ...r });
    if (r.st in A.counts) A.counts[r.st]++;
    if (SEV[r.st] > SEV[A.st]) A.st = r.st;
  }
  for (const A of Object.values(byArea)) A.tasks.sort((a, b) => (SEV[b.st] - SEV[a.st]) || ((a.due || Infinity) - (b.due || Infinity)));
  return byArea;
}
function needs(C) {
  const out = [];
  for (const A of Object.values(C)) for (const x of A.tasks) if (x.st === 'red' || x.st === 'orange') out.push({ ...x, area: A.area });
  return out.sort((a, b) => (SEV[b.st] - SEV[a.st]) || ((a.due || 9e15) - (b.due || 9e15)));
}

/* ---------------- GitHub ---------------- */
class ApiError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
async function gh(path, token) {
  let r;
  try { r = await fetch(API + path, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } }); }
  catch { throw new ApiError('offline', 'Offline. Showing the last saved copy.'); }
  if (r.status === 401) throw new ApiError('auth', 'GitHub rejected the token (wrong, revoked or expired).');
  if (r.status === 404) throw new ApiError('notfound', 'This token can\'t see the data repo. Give it access to home-3d-data.');
  if (r.status === 403) throw new ApiError('forbidden', 'This token needs Contents: Read on the data repo.');
  if (!r.ok) throw new ApiError('http', `GitHub error ${r.status}`);
  return r.json();
}
function b64utf8(b64) { const bin = atob(b64.replace(/\n/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
async function fetchData(token = S.token, repo = S.repo) {
  const j = await gh(`/repos/${repo}/contents/${FILE}`, token);
  const d = JSON.parse(b64utf8(j.content || ''));
  if (!d || !Array.isArray(d.tasks)) throw new ApiError('bad', 'tasks.json looks wrong.');
  return d;
}
function setData(d, save) {
  S.data = d;
  if (save) { try { localStorage.setItem(LS.cache, JSON.stringify(d)); localStorage.setItem(LS.fetched, new Date().toISOString()); } catch {} }
}

/* ---------------- views ---------------- */
function render() {
  const root = $('#app');
  if (!EMBED && (!S.token || S.view === 'setup')) { teardown3D(); root.innerHTML = setupHTML(); bindSetup(); return; }
  if (!S.data) { root.innerHTML = `<div class="page"><p class="lead">Loading your house…</p></div>`; return; }
  if (S.view === 'settings') { teardown3D(); root.innerHTML = settingsHTML(); bindCommon(); return; }
  root.innerHTML = homeHTML();
  bindCommon();
  mount3D();
  paintAll();
}
function setupHTML() {
  return `<div class="page setup">
    <div class="logo" aria-hidden="true"></div>
    <h1>Connect Home 3D</h1>
    <p class="lead">Your maintenance list lives in the private GitHub repo <b>${esc(S.repo)}</b>. Paste a read-only token once and this phone keeps it.</p>
    <a class="btn primary wide link" href="${TOKEN_URL}" target="_blank" rel="noopener noreferrer">1. Create the token on GitHub</a>
    <ol class="steps">
      <li>Signed in as <b>braydendueck</b>, the name and Contents: Read are filled in for you.</li>
      <li>Under <b>Repository access</b> pick <b>Only select repositories</b> → <b>home-3d-data</b>.</li>
      <li>Tap <b>Generate token</b>, copy the <code>github_pat_…</code> and paste it here.</li>
    </ol>
    <form id="setupform">
      <label class="field"><span>2. Paste the token</span><input id="tok" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <details class="adv"><summary>Data repo</summary><label class="field"><input id="repo" value="${esc(S.repo)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label></details>
      <p class="err" id="setuperr" hidden></p>
      <button class="btn primary wide" type="submit">3. Connect</button>
    </form>
    <p class="fine">The token stays on this phone. It can only read that one repo. This public app has no house data in it.</p>
  </div>`;
}
function bindSetup() {
  $('#setupform').onsubmit = async ev => {
    ev.preventDefault();
    const tok = $('#tok').value.trim(), repo = ($('#repo').value || '').trim() || DEFAULT_REPO;
    const err = $('#setuperr'); err.hidden = true;
    const btn = ev.submitter || $('#setupform button[type=submit]'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const d = await fetchData(tok, repo);
      S.token = tok; S.repo = repo; localStorage.setItem(LS.token, tok); localStorage.setItem(LS.repo, repo);
      setData(d, true); S.view = 'home'; render();
    } catch (ex) {
      err.hidden = false; err.textContent = ex.kind === 'auth' ? 'GitHub rejected this token. Check you copied all of it.' : ex.message;
      btn.disabled = false; btn.textContent = '3. Connect';
    }
  };
}
function headerHTML() {
  const t0 = today();
  return `<header class="top">
    <div class="ttl"><h1>Home</h1><div class="meta">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t0.getDay()]} ${fmt(t0, true)}</div></div>
    <button class="chip sos" data-act="sos">Emergency</button>
    ${EMBED ? '' : `<button class="iconbtn" data-act="settings" aria-label="Settings">⚙︎</button>`}
  </header>`;
}
function homeHTML() {
  const C = S.C = computeAll();
  const N = needs(C);
  const shown = S.showAllNeeds ? N : N.slice(0, 3);
  const nRed = N.filter(x => x.st === 'red').length, nOr = N.length - nRed;
  const areas = Object.values(C).sort((a, b) => SEV[b.st] - SEV[a.st]);
  return `${headerHTML()}
  <main id="main">
    <section class="card needs" id="needs" aria-label="Needs you">
      <div class="needs-h"><h2>Needs you</h2><span class="sub">${N.length ? `${nRed ? `<b class="t-red">${nRed} urgent</b>` : ''}${nRed && nOr ? ' · ' : ''}${nOr ? `<b class="t-orange">${nOr} due soon</b>` : ''}` : 'All clear for now'}</span></div>
      ${shown.map(x => `<button class="nrow" data-area="${x.area.id}" data-task="${x.t.id}">
        <span class="dot" style="background:${COL[x.st]}"></span>
        <span class="nt"><span class="t">${esc(x.t.title)}</span><span class="s">${esc(x.area.label)} · ${esc(x.txt)}</span></span>
        <span class="chev">›</span></button>`).join('')}
      ${N.length > 3 ? `<button class="more" data-act="needsall">${S.showAllNeeds ? 'Show fewer' : `Show all ${N.length}`}</button>` : ''}
    </section>
    <div class="levels" role="tablist" aria-label="Show">${LEVELS.map(([k, l]) => `<button role="tab" class="lv ${S.level === k ? 'on' : ''}" data-act="level" data-lv="${k}" aria-selected="${S.level === k}">${l}</button>`).join('')}</div>
    <section class="stage" id="stage" aria-label="3D house">
      <div id="gl"></div>
      <div id="pins"></div>
      <div class="hint" id="hint" ${localStorage.getItem(LS.hinted) ? 'hidden' : ''}>Drag to turn · pinch to zoom · tap a label or a part</div>
      <div class="lvnote" id="lvnote"></div>
      <button class="fab" data-act="resetview" aria-label="Reset view">⟲</button>
    </section>
    <div class="legend" aria-label="Legend">
      ${['red', 'orange', 'yellow', 'clear'].map(k => `<span><i style="background:${COL[k]}"></i>${STLABEL[k]}${k === 'orange' ? ` (${S.data.soonDays || 14} days)` : ''}</span>`).join('')}
    </div>
    <section class="areas" aria-label="All areas">
      <h2>All areas</h2>
      <div class="agrid">
      ${areas.map(A => `<button class="acard st-${A.st}" data-area="${A.area.id}">
        <span class="dot" style="background:${COL[A.st]}"></span>
        <span class="al">${esc(A.area.label)}</span>
        <span class="ac">${countTxt(A)}</span></button>`).join('')}
      </div>
    </section>
    <section class="card month">${monthHTML()}</section>
    <p class="fine foot">${esc(footTxt())}</p>
  </main>
  <div class="scrim" id="scrim" hidden></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="shtitle">
    <button class="handle" data-act="close" aria-label="Close"></button>
    <div class="shead"><span class="dot big" id="shdot"></span><div class="sht"><h2 id="shtitle"></h2><div class="meta" id="shmeta"></div></div><button class="iconbtn" data-act="close" aria-label="Close">✕</button></div>
    <div class="sbody" id="shbody"></div>
  </div>`;
}
function countTxt(A) {
  const c = A.counts, p = [];
  if (c.red) p.push(`${c.red} urgent`); if (c.orange) p.push(`${c.orange} soon`); if (c.yellow) p.push(`${c.yellow} to do`);
  return p.join(' · ') || 'Nothing due';
}
function footTxt() {
  const f = localStorage.getItem(LS.fetched);
  return `Guide dated ${S.data.guideDate || ''}.${f && !EMBED ? ` Synced ${fmt(new Date(f))}.` : ''} Colours use this phone's date. Done ticks are saved on this device.`;
}
function monthHTML() {
  const m = today().getMonth(), cal = S.data.calendar || [];
  const c = cal[m]; if (!c) return '';
  return `<details><summary><h2>${esc(c.month)} checklist</h2><span class="sub">${c.items.length} items from the guide</span></summary><ul>${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></details>`;
}
function settingsHTML() {
  const f = localStorage.getItem(LS.fetched);
  return `<header class="top"><button class="iconbtn" data-act="home" aria-label="Back">‹</button><div class="ttl"><h1>Settings</h1></div></header>
  <div class="page">
    <p class="lead">Connected to <b>${esc(S.repo)}</b>.${f ? ` Last synced ${fmt(new Date(f), true)}.` : ''}</p>
    <button class="btn wide" data-act="refresh">Refresh from GitHub</button>
    <button class="btn wide" data-act="newtoken">Enter a new token</button>
    <button class="btn wide" data-act="cleardone">Clear all done ticks</button>
    <button class="btn wide danger" data-act="signout">Forget token on this phone</button>
    ${S.data?.facts ? `<h2>House</h2><ul class="facts">${S.data.facts.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <h2>How colours work</h2>
    <ul class="facts">
      <li><b class="t-red">Red</b>: flagged urgent in the guide, or an essential job whose date passed in the last ${S.data?.overdueGraceDays || 30} days.</li>
      <li><b class="t-orange">Orange</b>: due within ${S.data?.soonDays || 14} days (a week for monthly jobs).</li>
      <li><b class="t-yellow">Yellow</b>: on the list but not pressing yet.</li>
      <li><b>Grey</b>: nothing due. As-needed jobs and upsell watch-outs never colour an area. Optional jobs stop at yellow.</li>
    </ul>
  </div>`;
}

/* ---------------- sheet ---------------- */
function openArea(id, taskId) {
  const A = S.C[id]; if (!A) return;
  S.sel = id; dismissHint();
  $('#shdot').style.background = COL[A.st];
  $('#shtitle').textContent = A.area.label;
  $('#shmeta').textContent = `${STLABEL[A.st]} · ${countTxt(A)}`;
  const main = A.tasks.filter(x => x.st !== 'watch'), watch = A.tasks.filter(x => x.st === 'watch');
  $('#shbody').innerHTML = main.map(taskHTML).join('') +
    (watch.length ? `<details class="watch"><summary>Watch out for upsells (${watch.length})</summary>${watch.map(taskHTML).join('')}</details>` : '') +
    (A.area.notes?.length ? `<details class="notes"><summary>More notes</summary>${A.area.notes.map(n => `<p>${esc(n)}</p>`).join('')}</details>` : '');
  $('#sheet').dataset.area = id;
  $('#sheet').classList.add('open'); $('#scrim').hidden = false; S.openedAt = performance.now();
  $('#shbody').scrollTop = 0;
  if (taskId) { const el = $(`#shbody [data-tid="${taskId}"]`); if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'start' }); } }
  highlight3D(id);
}
function taskHTML(x) {
  const t = x.t, rec = S.done[t.id] || {};
  const canDone = x.st !== 'watch' && !['asneeded', 'cond', 'season'].includes(t.schedule?.k);
  return `<article class="task st-${x.st}" data-tid="${t.id}">
    <div class="th"><span class="dot" style="background:${x.st === 'watch' ? 'transparent' : COL[x.st]}"></span><h3>${esc(t.title)}</h3><span class="vb v-${t.verdict}">${esc(t.verdictLabel)}</span></div>
    <p class="why ${x.st}">${esc(x.txt)}</p>
    <dl class="kv"><dt>When</dt><dd>${esc(t.freq)}</dd><dt>Who</dt><dd>${esc(t.who)}</dd><dt>Cost</dt><dd>${esc(t.cost)}</dd></dl>
    ${t.why ? `<p class="tip">${esc(t.why)}</p>` : ''}
    <details class="note"><summary>Guide notes</summary><p>${esc(t.note)}</p></details>
    ${canDone ? `<div class="acts">
      <button class="btn small ${rec.done ? 'on' : ''}" data-done="${t.id}">${rec.done ? `✓ Done ${fmt(parseISO(rec.done))} · undo` : 'Mark done today'}</button>
      ${t.urgent && !rec.done ? `<button class="btn small ${rec.booked ? 'on' : ''}" data-book="${t.id}">${rec.booked ? '✓ Booked · undo' : 'Booked'}</button>` : ''}
    </div>` : ''}
  </article>`;
}
function closeSheet() { $('#sheet')?.classList.remove('open'); const s = $('#scrim'); if (s) s.hidden = true; S.sel = null; highlight3D(null); }
function openSOS() {
  const rf = S.data.redFlags || [];
  $('#shdot').style.background = COL.red;
  $('#shtitle').textContent = 'Emergency';
  $('#shmeta').textContent = 'What to do first, and who to call';
  $('#shbody').innerHTML = rf.map(r => `<article class="task"><h3>${esc(r.sign)}</h3><p>${esc(r.do)}</p><p class="tip"><b>Call:</b> ${esc(r.call)}</p></article>`).join('');
  $('#sheet').dataset.area = 'sos';
  $('#sheet').classList.add('open'); $('#scrim').hidden = false; $('#shbody').scrollTop = 0;
}
function saveDone() { localStorage.setItem(LS.done, JSON.stringify(S.done)); }
function refreshHome(keepSheet) {
  const sel = S.sel, sy = window.scrollY, shs = $('#shbody')?.scrollTop || 0;
  S.C = computeAll();
  const main = $('#main'); if (!main) return render();
  const tmp = document.createElement('div'); tmp.innerHTML = homeHTML();
  $('#needs').replaceWith(tmp.querySelector('#needs'));
  $('.areas').replaceWith(tmp.querySelector('.areas'));
  paintAll();
  if (keepSheet && sel) { openArea(sel); $('#shbody').scrollTop = shs; }
  window.scrollTo(0, sy);
}

/* ---------------- events ---------------- */
let bound = false;
function bindCommon() {
  if (bound) return; bound = true;
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act],[data-area],[data-done],[data-book]'); if (!el) return;
    if (el.dataset.done) { const id = el.dataset.done, r = S.done[id] || {}; if (r.done) delete r.done; else { r.done = iso(today()); delete r.booked; } S.done[id] = r; saveDone(); refreshHome(true); return; }
    if (el.dataset.book) { const id = el.dataset.book, r = S.done[id] || {}; if (r.booked) delete r.booked; else r.booked = iso(today()); S.done[id] = r; saveDone(); refreshHome(true); return; }
    if (el.dataset.area && !el.dataset.act) { if (el.closest('#sheet')) return; openArea(el.dataset.area, el.dataset.task); return; }
    const a = el.dataset.act;
    if (a === 'close') closeSheet();
    else if (a === 'sos') openSOS();
    else if (a === 'needsall') { S.showAllNeeds = !S.showAllNeeds; refreshHome(false); }
    else if (a === 'resetview') resetView();
    else if (a === 'level') setLevel(el.dataset.lv);
    else if (a === 'settings') { S.view = 'settings'; render(); }
    else if (a === 'home') { S.view = 'home'; render(); }
    else if (a === 'newtoken') { S.view = 'setup'; render(); }
    else if (a === 'cleardone') { if (confirm('Clear every done tick on this phone?')) { S.done = {}; saveDone(); toast('Cleared'); } }
    else if (a === 'signout') { if (confirm('Forget the token and saved copy on this phone?')) { [LS.token, LS.repo, LS.cache, LS.fetched].forEach(k => localStorage.removeItem(k)); S.token = ''; S.data = null; S.view = 'setup'; render(); } }
    else if (a === 'refresh') { try { setData(await fetchData(), true); toast('Up to date'); render(); } catch (ex) { toast(ex.message); } }
  });
  document.addEventListener('click', e => { if (e.target.id === 'scrim' && performance.now() - (S.openedAt || 0) > 350) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
}
function toast(m) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); } t.textContent = m; t.className = 'show'; clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 2600); }
function dismissHint() { const h = $('#hint'); if (h) h.hidden = true; localStorage.setItem(LS.hinted, '1'); }

/* ---------------- 3D house ---------------- */
const G = { r: null };
const LEVELS = [['all', 'Whole house'], ['outside', 'Outside'], ['main', 'Main floor'], ['basement', 'Basement']];
const AREA_LEVEL = { roof: 'outside', attic: 'outside', walls: 'outside', ac: 'outside', yard: 'outside', papers: 'outside',
  kitchen: 'main', bath: 'main', safety: 'main', furnace: 'basement', water: 'basement', sump: 'basement', laundry: 'basement',
  electrical: 'basement', pests: 'basement', foundation: 'basement' };
const VIEWS = { all: { t: [0, 1.4, 0], el: 0.45, d: 0.88 }, outside: { t: [0, 2.4, 0], el: 0.3, d: 1 }, main: { t: [0, 3.2, -0.3], el: 0.75, d: 0.8 }, basement: { t: [0, -1.4, 0.4], el: 0.72, d: 0.72 } };
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
function teardown3D() { if (G.r) { G.r.renderer.setAnimationLoop(null); G.r.renderer.dispose(); G.r.ro?.disconnect(); G.r = null; } }
function mount3D() {
  teardown3D();
  const T = window.THREE, host = $('#gl'); if (!T || !host) return;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  host.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 200);
  scene.add(new T.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
  const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(6, 14, 9); scene.add(sun);
  const parts = buildHouse(T, scene);
  const controls = new window.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.enablePan = false;
  controls.minDistance = 12; controls.maxDistance = 60; controls.maxPolarAngle = Math.PI * 0.49; controls.minPolarAngle = 0.15;
  controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_ROTATE };
  controls.target.set(0, 1.6, 0);
  G.r = { T, renderer, scene, camera, controls, parts, dirty: true, hl: null, t0: performance.now() };
  controls.addEventListener('change', () => { G.r.dirty = true; dismissHintSoon(); });
  // tap = short press without much movement
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), n: (down?.n || 0) + 1 }; });
  renderer.domElement.addEventListener('pointerup', e => { if (down) { down.d = Math.hypot(e.clientX - down.x, e.clientY - down.y); down.dt = performance.now() - down.t; } });
  // open on click (not pointerup) so the follow-up click can't land on the new scrim and close it again
  renderer.domElement.addEventListener('click', e => {
    const d = down; down = null;
    if (d && (d.d > 8 || d.dt > 500)) return;
    const id = pick(e.clientX, e.clientY); if (id) openArea(id);
  });
  const ro = new ResizeObserver(() => resize()); ro.observe(host); G.r.ro = ro;
  resize(); applyLevel(); resetView(true);
  renderer.setAnimationLoop(frame);
}
let hintTimer = 0;
function dismissHintSoon() { if (hintTimer) return; hintTimer = setTimeout(() => { hintTimer = 0; if (G.r && performance.now() - G.r.t0 > 1500) dismissHint(); }, 300); }
function resize() {
  const r = G.r; if (!r) return; const host = $('#gl'); const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  r.renderer.setSize(w, h, false); r.camera.aspect = w / h;
  r.camera.updateProjectionMatrix(); r.dirty = true;
}
function viewPose(lv) {
  const r = G.r, v = VIEWS[lv] || VIEWS.all, az = 0.55;
  const dist = (r.camera.aspect < 0.8 ? 44 : r.camera.aspect < 1.2 ? 39 : 33) * v.d;
  const t = new r.T.Vector3(...v.t);
  return { t, p: new r.T.Vector3(Math.sin(az) * Math.cos(v.el) * dist, Math.sin(v.el) * dist, Math.cos(az) * Math.cos(v.el) * dist).add(t) };
}
function resetView(instant) {
  const r = G.r; if (!r) return;
  const to = viewPose(S.level);
  if (instant) { r.camera.position.copy(to.p); r.controls.target.copy(to.t); r.controls.update(); r.dirty = true; return; }
  r.anim = { t0: performance.now(), p0: r.camera.position.clone(), q0: r.controls.target.clone(), to };
}
function setLevel(lv) {
  S.level = lv;
  document.querySelectorAll('.lv').forEach(b => { b.classList.toggle('on', b.dataset.lv === lv); b.setAttribute('aria-selected', b.dataset.lv === lv); });
  applyLevel(); resetView(false); buildPins();
}
function applyLevel() {
  const r = G.r; if (!r) return;
  const lv = S.level;
  r.scene.traverse(o => {
    if (!o.isMesh) return;
    const fade = lv !== 'all' && lv !== 'outside' && o.userData.level !== lv;
    const m = o.material; m.transparent = fade; m.opacity = fade ? 0.1 : 1; m.depthWrite = !fade; m.needsUpdate = true;
    o.userData.faded = fade;
  });
  const note = $('#lvnote');
  if (note) note.textContent = lv === 'all' ? 'Labels show what needs you. Pick a level to see every part.' : '';
  r.dirty = true;
}
function frame() {
  const r = G.r; if (!r) return;
  if (r.anim) {
    const k = Math.min(1, (performance.now() - r.anim.t0) / 450), e = 1 - Math.pow(1 - k, 3);
    r.camera.position.lerpVectors(r.anim.p0, r.anim.to.p, e); r.controls.target.lerpVectors(r.anim.q0, r.anim.to.t, e);
    if (k >= 1) r.anim = null; r.dirty = true;
  }
  r.controls.update();
  if (r.hl) { const k = 0.5 + 0.5 * Math.sin(performance.now() / 260); for (const m of r.hl) m.emissiveIntensity = 0.15 + 0.35 * k; r.dirty = true; }
  if (!r.dirty) return;
  r.dirty = false;
  r.renderer.render(r.scene, r.camera);
  placePins();
}
function pick(cx, cy) {
  const r = G.r, T = r.T, rect = r.renderer.domElement.getBoundingClientRect();
  const v = new T.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
  const rc = new T.Raycaster(); rc.setFromCamera(v, r.camera);
  const hits = rc.intersectObjects(r.parts.pickables, false);
  for (const h of hits) { if (h.object.userData.faded) continue; let o = h.object; while (o && !o.userData.area) o = o.parent; if (o) return o.userData.area; }
  return null;
}
function paintAll() {
  const r = G.r; if (!r || !S.C) return;
  for (const [id, grp] of Object.entries(r.parts.areas)) {
    const st = S.C[id]?.st || 'clear';
    for (const m of grp.mats) {
      const base = new r.T.Color(m.userData.base);
      if (st === 'clear') m.color.copy(base); else m.color.copy(base).lerp(new r.T.Color(COL[st]), m.userData.tint ?? 0.75);
    }
  }
  buildPins(); r.dirty = true;
}
function highlight3D(id) {
  const r = G.r; if (!r) return;
  if (r.hl) for (const m of r.hl) { m.emissive.setHex(0); m.emissiveIntensity = 0; }
  r.hl = id && r.parts.areas[id] ? r.parts.areas[id].mats : null;
  if (S.level === 'all') buildPins();
  if (r.hl) for (const m of r.hl) m.emissive.setHex(0xffffff);
  document.querySelectorAll('.pin').forEach(p => p.classList.toggle('sel', p.dataset.area === id));
  r.dirty = true;
}
function buildPins() {
  const box = $('#pins'); if (!box || !S.C) return;
  const lv = S.level;
  const show = a => lv === 'all' ? ['red', 'orange'].includes(S.C[a.id]?.st) || S.sel === a.id : AREA_LEVEL[a.id] === lv;
  box.innerHTML = S.data.areas.filter(a => G.r.parts.areas[a.id] && show(a)).map(a => {
    const st = S.C[a.id]?.st || 'clear';
    return `<button class="pin st-${st}" data-area="${a.id}" aria-label="${esc(a.label)}: ${STLABEL[st]}"><i style="background:${COL[st]}"></i><span>${esc(a.short || a.label)}</span></button>`;
  }).join('');
  G.r.pinEls = [...box.children];
}
function screenOf(id) {
  const r = G.r, a = r.parts.areas[id]; if (!a) return null;
  const p = a.anchor.clone().project(r.camera), el = r.renderer.domElement;
  return { x: (p.x + 1) / 2 * el.clientWidth, y: (1 - p.y) / 2 * el.clientHeight, z: p.z, behind: p.z > 1 };
}
function placePins() {
  const r = G.r; if (!r?.pinEls) return;
  const W = r.renderer.domElement.clientWidth, H = r.renderer.domElement.clientHeight;
  const items = r.pinEls.map(el => ({ el, id: el.dataset.area, p: screenOf(el.dataset.area), sev: SEV[S.C[el.dataset.area]?.st || 'clear'] }));
  items.sort((a, b) => (b.sev - a.sev) || (a.p.z - b.p.z));
  const placed = [];
  for (const it of items) {
    const { el, p } = it;
    if (!p || p.behind || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { el.style.display = 'none'; continue; }
    el.style.display = ''; el.classList.remove('mini');
    const w = el.offsetWidth || 70, h = el.offsetHeight || 28;
    let x = Math.max(4, Math.min(W - w - 4, p.x - w / 2)), y = Math.max(4, Math.min(H - h - 4, p.y - h / 2));
    // try the spot, then nudges around it; if all collide, fall back to a small dot; hide if even that collides
    const hit = (x, y, w, h) => placed.some(q => x < q.x + q.w + 2 && x + w + 2 > q.x && y < q.y + q.h + 2 && y + h + 2 > q.y);
    let ok = false, mini = false;
    const offs = [[0, 0], [0, -h - 3], [0, h + 3], [w / 2 + 3, 0], [-w / 2 - 3, 0], [0, -2 * h - 6], [0, 2 * h + 6], [w / 2 + 3, -h - 3], [-w / 2 - 3, -h - 3], [w / 2 + 3, h + 3], [-w / 2 - 3, h + 3]];
    for (const [dx, dy] of offs) {
      const xx = Math.max(4, Math.min(W - w - 4, x + dx)), yy = Math.max(4, Math.min(H - h - 4, y + dy));
      if (!hit(xx, yy, w, h)) { x = xx; y = yy; ok = true; break; }
    }
    if (!ok) { const m = 30, xx = p.x - m / 2, yy = p.y - m / 2; if (!hit(xx, yy, m, m)) { x = xx; y = yy; ok = mini = true; } }
    el.classList.toggle('mini', mini);
    if (!ok) { el.style.display = 'none'; continue; }
    el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    const ww = mini ? 30 : w, hh = mini ? 30 : h;
    placed.push({ x, y, w: ww, h: hh }); continue;
  }
}

function buildHouse(T, scene) {
  const areas = {}, pickables = [];
  const D = dark();
  const mat = (hex, opts = {}) => new T.MeshLambertMaterial({ color: hex, flatShading: true, ...opts });
  const amat = (id, hex, tint) => { const m = new T.MeshLambertMaterial({ color: hex, flatShading: true }); m.userData.base = hex; m.userData.tint = tint ?? 0.75; (areas[id] ||= { mats: [], anchor: new T.Vector3(), group: new T.Group() }).mats.push(m); return m; };
  let LV = 'outside';
  const add = (geo, m, x, y, z, parent = scene, area) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.userData.level = LV; parent.add(o); if (area) { o.userData.area = area; pickables.push(o); } return o; };
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const anchor = (id, x, y, z) => { (areas[id] ||= { mats: [], anchor: new T.Vector3() }).anchor.set(x, y, z); };
  const W = 12, Dp = 8, FH = 2.5, BD = 2.4, wall = 0.18; // footprint, floor height, basement depth
  const fx = W / 2, fz = Dp / 2;

  // ---- ground block (cut at the front of the house so the basement shows)
  const soil = mat(D ? 0x5b4a3c : 0x8a6d55), grass = amat('yard', D ? 0x4f7a45 : 0x7fb069, 0.12);
  const gx0 = -9.5, gx1 = 9.5, gz0 = -7, gz1 = fz;
  const ground = new T.Group(); scene.add(ground);
  // soil around the basement: back, left, right slabs
  add(box(gx1 - gx0, BD + 0.6, gz0 * -1 - fz), soil, 0, -(BD + 0.6) / 2, (gz0 - fz) / 2, ground);
  add(box(fx + gx1 - 2 * fx, BD + 0.6, 2 * fz), soil, (fx + gx1) / 2, -(BD + 0.6) / 2, 0, ground);
  add(box(-gx0 - fx, BD + 0.6, 2 * fz), soil, (gx0 - fx) / 2, -(BD + 0.6) / 2, 0, ground);
  add(box(2 * fx, 0.6, 2 * fz), soil, 0, -BD - 0.3, 0, ground);
  // lawn on top (pickable as yard)
  const lawn = [[gx1 - gx0, gz0 * -1 - fz, 0, (gz0 - fz) / 2], [gx1 - fx, 2 * fz, (fx + gx1) / 2, 0], [-gx0 - fx, 2 * fz, (gx0 - fx) / 2, 0]];
  for (const [w, d, x, z] of lawn) add(box(w, 0.12, d), grass, x, 0.06, z, ground, 'yard');
  // tree + shrubs (yard)
  const trunk = mat(0x7a5a3a), leaf = amat('yard', D ? 0x3f6b3a : 0x5d9a4f, 0.85);
  add(new T.CylinderGeometry(0.18, 0.24, 1.6, 6), trunk, -8.0, 0.8, -5.2, scene);
  add(new T.ConeGeometry(1.3, 2.6, 7), leaf, -8.0, 2.6, -5.2, scene, 'yard');
  add(new T.IcosahedronGeometry(0.7, 0), leaf, -7.8, 0.55, 2.6, scene, 'yard');
  add(new T.IcosahedronGeometry(0.55, 0), leaf, 8.4, 0.45, -5.8, scene, 'yard');
  anchor('yard', -8.0, 4.2, -5.2);

  LV = 'basement';
  // ---- foundation / basement walls (concrete)
  const conc = amat('foundation', D ? 0x8d9097 : 0xb9b6ae, 0.6);
  add(box(W, BD, wall), conc, 0, -BD / 2, -fz + wall / 2, scene, 'foundation');
  add(box(wall, BD, Dp), conc, -fx + wall / 2, -BD / 2, 0, scene, 'foundation');
  add(box(wall, BD, Dp), conc, fx - wall / 2, -BD / 2, 0, scene, 'foundation');
  add(box(W, 0.12, Dp), mat(D ? 0x6f7177 : 0xa19d94), 0, -BD + 0.06, 0, scene);
  // front cut edge of the foundation (a low curb so the cutaway reads)
  add(box(W, 0.35, wall), conc, 0, -BD + 0.175, fz - wall / 2, scene, 'foundation');
  anchor('foundation', -fx + 0.4, -BD + 0.4, fz - 0.4);

  // ---- basement contents
  const furn = amat('furnace', 0xd8d4cc);
  add(box(1.0, 1.7, 0.9), furn, -1.4, -BD + 0.85 + 0.12, 0.6, scene, 'furnace');
  add(box(0.5, 2.3, 0.5), amat('furnace', 0xc3c0b8), -1.4, -BD + 1.7 + 1.1, 0.6, scene, 'furnace'); // duct up
  anchor('furnace', -1.4, -BD + 1.9, 0.6);
  const wh = amat('water', 0xe9e6df);
  add(new T.CylinderGeometry(0.45, 0.45, 1.5, 12), wh, 0.2, -BD + 0.75 + 0.12, 0.2, scene, 'water');
  add(new T.CylinderGeometry(0.06, 0.06, 2.4, 6), amat('water', 0xb07a4b), 0.2, -BD + 1.2, -0.6, scene, 'water');
  anchor('water', 0.2, -BD + 1.75, 0.2);
  // sump pit + floor drain
  const pit = amat('sump', 0x5d6b78, 0.85);
  add(new T.CylinderGeometry(0.55, 0.55, 0.16, 14), pit, 2.4, -BD + 0.17, 2.0, scene, 'sump');
  add(new T.CylinderGeometry(0.25, 0.25, 0.14, 10), pit, 1.0, -BD + 0.16, 2.6, scene, 'sump');
  anchor('sump', 2.4, -BD + 0.5, 2.0);
  // laundry
  const lw = amat('laundry', 0xf1efe9);
  add(box(0.8, 0.95, 0.8), lw, -4.4, -BD + 0.6, -0.4, scene, 'laundry');
  add(box(0.8, 0.95, 0.8), lw, -4.4, -BD + 0.6, 0.55, scene, 'laundry');
  anchor('laundry', -4.4, -BD + 1.3, 0.1);
  // electrical panel on right basement wall
  add(box(0.12, 0.9, 0.6), amat('electrical', 0x9aa4ad, 0.85), fx - wall - 0.06, -0.9, -0.8, scene, 'electrical');
  anchor('electrical', fx - 0.4, -0.7, -0.8);
  // pests & storage shelf
  const shelf = amat('pests', D ? 0x8b6b4a : 0xa9825a, 0.7);
  add(box(1.6, 1.4, 0.45), shelf, 4.4, -BD + 0.82, 2.6, scene, 'pests');
  add(box(0.45, 0.4, 0.35), mat(0xd9c39a), 4.0, -BD + 1.75, 2.6, scene);
  anchor('pests', 4.4, -BD + 1.6, 2.6);

  LV = 'main';
  // ---- main floor, attic and roof float above the basement (exploded view)
  const LIFT = 2.2, up = new T.Group(); up.position.y = LIFT; scene.add(up);
  const floorM = mat(D ? 0x9b8a74 : 0xd8c6a6);
  add(box(W, 0.16, Dp), floorM, 0, 0.08, 0, up);
  const wallM = amat('walls', D ? 0xb8b2a8 : 0xefe9de, 0.35);
  // back + side walls (front is cut away)
  add(box(W, FH, wall), wallM, 0, FH / 2 + 0.16, -fz + wall / 2, up, 'walls');
  add(box(wall, FH, Dp), wallM, -fx + wall / 2, FH / 2 + 0.16, 0, up, 'walls');
  add(box(wall, FH, Dp), wallM, fx - wall / 2, FH / 2 + 0.16, 0, up, 'walls');
  // windows (coloured with walls)
  const glass = amat('walls', 0x8fb8d8, 0.8);
  for (const z of [-2, 1.8]) add(box(0.06, 1.0, 1.4), glass, fx + 0.02, 1.5, z, up, 'walls');
  for (const x of [-3.5, 3.5]) add(box(1.4, 1.0, 0.06), glass, x, 1.5, -fz - 0.02, up, 'walls');
  add(box(0.06, 1.0, 1.4), glass, -fx - 0.02, 1.5, 0, up, 'walls');
  anchor('walls', fx + 0.1, LIFT + 1.7, 1.8);
  // interior partitions
  const part = mat(D ? 0xa59f95 : 0xe2dbcd);
  add(box(0.1, FH, 4.0), part, -1.0, FH / 2 + 0.16, -2.0, up);
  add(box(0.1, FH, 3.2), part, 1.8, FH / 2 + 0.16, -2.4, up);
  add(box(2.8, FH, 0.1), part, 0.4, FH / 2 + 0.16, -0.8, up);
  // kitchen (back left): floor tint, counter, fridge, stove
  add(box(4.9, 0.03, 4.0), amat('kitchen', D ? 0xa79c88 : 0xe8e0cf, 0.45), -3.5, 0.18, -2.0, up, 'kitchen');
  const kc = amat('kitchen', 0xcfc8bb, 0.8);
  add(box(3.4, 0.9, 0.6), kc, -3.6, 0.61, -fz + 0.5, up, 'kitchen');
  add(box(0.8, 1.8, 0.7), amat('kitchen', 0xf4f3ef, 0.8), -5.4, 1.06, -fz + 0.55, up, 'kitchen');
  anchor('kitchen', -3.6, LIFT + 1.6, -fz + 0.6);
  // bathroom (back middle): tub + toilet
  add(box(2.7, 0.03, 3.1), amat('bath', D ? 0x8ea0ad : 0xd7e3ea, 0.45), 0.4, 0.18, -2.4, up, 'bath');
  const porc = amat('bath', 0xf6f6f4, 0.8);
  add(box(1.6, 0.55, 0.75), porc, 0.3, 0.44, -fz + 0.6, up, 'bath');
  add(box(0.45, 0.45, 0.55), porc, 1.3, 0.4, -1.5, up, 'bath');
  anchor('bath', 0.4, LIFT + 1.4, -2.6);
  // alarms: big discs on the ceiling line of the hall / bedrooms
  const alarm = amat('safety', 0xfafafa, 0.85);
  for (const [x, z] of [[0.4, 1.5], [4.0, -1.5]]) { const d = add(new T.CylinderGeometry(0.32, 0.32, 0.12, 14), alarm, x, FH + 0.02, z, up, 'safety'); }
  anchor('safety', 0.4, LIFT + FH + 0.3, 1.5);
  // living room couch (decor)
  add(box(2.2, 0.6, 0.8), mat(D ? 0x5a6f8c : 0x7d97b8), -3.6, 0.46, 2.3, up);
  // bed (decor)
  add(box(1.6, 0.5, 2.1), mat(D ? 0x8c7a9a : 0xb9a6c9), 4.0, 0.41, -2.4, up);

  LV = 'outside';
  // ---- attic insulation (floating ceiling slab, exploded view)
  const ins = amat('attic', D ? 0xc79aa5 : 0xf2c6cf, 0.65);
  add(box(W - 0.4, 0.24, 2.2), ins, 0, FH + 0.55, -fz + 1.3, up, 'attic');
  anchor('attic', -3.2, LIFT + FH + 0.75, -fz + 1.3);

  // ---- roof (gable along x, lifted for the exploded view)
  const roofM = amat('roof', D ? 0x5b5f68 : 0x6f7480, 0.7);
  const ry = FH + 1.5, rise = 1.9, over = 0.6, half = fz + over;
  const slopeLen = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  const back = add(box(W + 2 * over, 0.16, slopeLen), roofM, 0, ry + rise / 2, -half / 2, up, 'roof'); back.rotation.x = -ang;
  // front slope is cut away (dollhouse view); a thin ridge cap marks the peak
  add(box(W + 2 * over, 0.22, 0.3), roofM, 0, ry + rise, 0, up, 'roof');
  // gutters + downspout
  const gut = amat('roof', 0xd9d9d9, 0.85);
  add(box(W + 2 * over, 0.16, 0.2), gut, 0, ry - 0.05, -half, up, 'roof');
  add(box(0.16, ry + 0.2, 0.16), gut, fx + over - 0.1, (ry - 0.1) / 2, -half + 0.1, up, 'roof');
  add(box(0.16, 0.16, 1.4), gut, fx + over - 0.1, 0.2, -half + 0.8, up, 'roof');
  anchor('roof', 3.0, LIFT + ry + rise * 0.55, -half / 2);

  // ---- AC unit (right side)
  const acM = amat('ac', 0xc9ccd1, 0.8);
  add(box(1.0, 0.9, 1.0), acM, fx + 1.4, 0.57, -1.6, scene, 'ac');
  add(new T.CylinderGeometry(0.38, 0.38, 0.06, 12), amat('ac', 0x6d737c, 0.8), fx + 1.4, 1.04, -1.6, scene, 'ac');
  anchor('ac', fx + 1.4, 1.5, -1.6);

  // ---- mailbox = records & insurance (front right corner of lot)
  const mb = amat('papers', D ? 0x6b8bb5 : 0x3f6fae, 0.7);
  add(box(0.1, 1.0, 0.1), mat(0x7a5a3a), 8.3, 0.6, 3.0, scene);
  add(box(0.55, 0.38, 0.75), mb, 8.3, 1.25, 3.0, scene, 'papers');
  anchor('papers', 8.3, 1.8, 3.0);

  // snowblower-ish shape for yard (left side)
  return { areas, pickables };
}

/* ---------------- boot ---------------- */
async function boot() {
  if (EMBED) { setData(EMBED, false); render(); return; }
  if (S.token) {
    try { const c = localStorage.getItem(LS.cache); if (c) S.data = JSON.parse(c); } catch {}
    render();
    try { const d = await fetchData(); const changed = JSON.stringify(d) !== JSON.stringify(S.data); setData(d, true); if (changed) render(); }
    catch (ex) { if (!S.data) { if (ex.kind === 'auth' || ex.kind === 'notfound' || ex.kind === 'forbidden') S.view = 'setup'; render(); } toast(ex.message); }
  } else render();
}
// re-colour at midnight / when the app comes back to the foreground
let lastDay = iso(today());
document.addEventListener('visibilitychange', () => { if (!document.hidden && iso(today()) !== lastDay && S.data && S.view === 'home') { lastDay = iso(today()); render(); } });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.view === 'home' && S.data) render(); });
window.H3D = { S, G, taskStatus, computeAll, screenOf, openArea, today, pick, setLevel, AREA_LEVEL };
boot();
