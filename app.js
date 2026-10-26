/* JARVIS Swing Desk — dependency-free client.
 * Data lives on the `state` branch of the user's PRIVATE repo and is read with the GitHub API
 * using a fine-grained token stored only in this browser. Refresh = dispatch the Jarvis workflow,
 * follow the run live, then reload the freshly saved data. */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const LS_KEY = 'jarvis.cfg.v1';
const WORKFLOW = 'jarvis.yml';
const STATE_REF = 'state';
const LOCAL = new URLSearchParams(location.search).has('local');   // dev: read ./data/… instead of GitHub
const DEFAULTS = { owner: 'Abhinav2629', repo: 'jarvis', token: '', theme: 'auto' };

let cfg = { ...DEFAULTS, ...safeParse(localStorageGet(LS_KEY)) };
const S = {
  dash: null, bt: null, msgs: null, tab: 'today',
  sort: { key: 'score', dir: -1 }, filt: { q: '', cap: 'All', sig: false },
  tracking: false, drawerSym: null,
};

/* ── utils ──────────────────────────────────────────────────────────── */
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fin = x => typeof x === 'number' && Number.isFinite(x);
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function inr(x) { return fin(x) ? '₹' + (Math.abs(x) >= 1000 ? nf0.format(x) : nf2.format(x)) : '–'; }
function inrShort(x) {
  if (!fin(x)) return '–';
  const a = Math.abs(x);
  if (a >= 1e7) return '₹' + (x / 1e7).toFixed(a >= 1e8 ? 0 : 1) + 'Cr';
  if (a >= 1e5) return '₹' + (x / 1e5).toFixed(a >= 1e6 ? 0 : 1) + 'L';
  return '₹' + nf0.format(x);
}
function num(x, d = 0) { return fin(x) ? x.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–'; }
function pct(x, d = 1, sign = true) { return fin(x) ? (sign && x > 0 ? '+' : '') + (x * 100).toFixed(d) + '%' : '–'; }
function pp(x, d = 1) { return fin(x) ? (x > 0 ? '+' : '') + x.toFixed(d) + '%' : '–'; }   // already in %
const tone = x => (fin(x) ? (x > 0 ? 'up' : x < 0 ? 'down' : '') : '');
const arrow = x => (fin(x) ? (x > 0 ? '▲' : x < 0 ? '▼' : '') : '');
function fmtDate(s, withYear = false) {
  if (!s) return '–';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return d.toLocaleDateString('en-IN', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}
function rel(iso) {
  if (!iso) return '–';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const setupMap = () => Object.fromEntries((S.dash?.setups || []).map(s => [s.key, s]));
const chartFile = sym => `dashboard/charts/${sym.replace(/&/g, '_')}.json`;

/* ── GitHub API ─────────────────────────────────────────────────────── */
async function gh(path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, {
    cache: 'no-store', ...opts,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const e = new Error(`GitHub ${res.status}`); e.status = res.status;
    try { e.detail = (await res.json()).message; } catch { /* ignore */ }
    throw e;
  }
  return res;
}
const repoPath = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
async function getState(path) {
  if (LOCAL) {
    const r = await fetch('data/' + path, { cache: 'no-store' });
    if (!r.ok) { const e = new Error('local ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  const r = await gh(`${repoPath()}/contents/${encodeURI(path)}?ref=${STATE_REF}`,
                     { headers: { Accept: 'application/vnd.github.raw+json' } });
  return r.json();
}
async function dispatch(task, inputs = {}) {
  await gh(`${repoPath()}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { task, ...inputs } }),
  });
}
async function runs(n = 10) {
  return (await (await gh(`${repoPath()}/actions/workflows/${WORKFLOW}/runs?per_page=${n}`)).json()).workflow_runs || [];
}

/* ── loading ────────────────────────────────────────────────────────── */
async function loadAll(quiet = false) {
  if (!cfg.token && !LOCAL) { showOnboarding(); return; }
  $('#main').classList.add('stale');
  const [d, b, m] = await Promise.allSettled([
    getState('dashboard/dashboard.json'), getState('dashboard/backtest.json'), getState('dashboard/messages.json'),
  ]);
  $('#main').classList.remove('stale');
  if (d.status === 'rejected') {
    const st = d.reason?.status;
    if (st === 401 || st === 403) { toast('Token rejected — check it in Settings'); openSettings(); return; }
    if (st === 404) { showNoData(); return; }
    toast('Could not load data: ' + (d.reason?.message || 'network error'));
    return;
  }
  S.dash = d.value;
  S.bt = b.status === 'fulfilled' ? b.value : null;
  S.msgs = m.status === 'fulfilled' ? m.value : null;
  $('#onboard').classList.remove('active');
  renderAll();
  if (!quiet) toast('Data as of close ' + fmtDate(S.dash.asof, true));
}

/* ── refresh / run tracking ─────────────────────────────────────────── */
const TASK_LABEL = { refresh: 'Refreshing prices & signals', 'pos-add': 'Adding your trade', 'pos-close': 'Closing position',
                     scan: 'Running the daily scan', maintain: 'Weekly maintenance' };

async function startTask(task, inputs = {}) {
  if (LOCAL) { toast('Local preview — runs are disabled'); return; }
  if (!cfg.token) { openSettings(); return; }
  if (S.tracking) { toast('Jarvis is already running — hang on'); return; }
  setRunning(true, 'Starting Jarvis…', 2);
  const since = Date.now() - 15000;
  try {
    await dispatch(task, inputs);
  } catch (e) {
    setRunning(false);
    toast(e.status === 403 || e.status === 404 ? 'Token needs “Actions: Read and write” on the repo' : 'Could not start: ' + e.message, 6000);
    return;
  }
  let run = null;
  for (let i = 0; i < 25 && !run; i++) {
    await sleep(2500);
    try { run = (await runs(10)).find(r => r.event === 'workflow_dispatch' && new Date(r.created_at).getTime() >= since); } catch { /* retry */ }
  }
  if (!run) { setRunning(false); toast('Started, but could not find the run yet — data will update when it finishes'); return; }
  await follow(run, TASK_LABEL[task] || 'Running Jarvis');
}

async function follow(run, label) {
  S.tracking = true;
  const t0 = new Date(run.run_started_at || run.created_at).getTime();
  $('#runLink').href = run.html_url;
  try {
    for (;;) {
      run = await (await gh(`${repoPath()}/actions/runs/${run.id}`)).json();
      const el = Math.max(0, Math.round((Date.now() - t0) / 1000));
      const clock = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;
      if (run.status === 'completed') break;
      if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') {
        setRunning(true, `${label} · queued ${clock}`, 4);
      } else {
        let step = '', prog = 10;
        try {
          const jobs = (await (await gh(`${repoPath()}/actions/runs/${run.id}/jobs`)).json()).jobs || [];
          const steps = jobs[0]?.steps || [];
          const cur = steps.find(s => s.status === 'in_progress');
          const done = steps.filter(s => s.status === 'completed').length;
          step = cur ? cur.name : '';
          prog = steps.length ? Math.max(8, Math.round(done / steps.length * 100)) : 10;
        } catch { /* jobs not visible yet */ }
        setRunning(true, `${label} · ${step || 'running'} · ${clock}`, prog);
      }
      await sleep(5000);
    }
  } catch (e) {
    S.tracking = false; setRunning(false);
    toast('Lost track of the run: ' + e.message); return;
  }
  S.tracking = false;
  setRunning(false);
  if (run.conclusion === 'success') {
    await loadAll(true);
    toast('✓ Fresh data saved & loaded');
  } else {
    toast(`Run ${run.conclusion} — open the logs from Settings`, 7000);
  }
}

function setRunning(on, text = '', prog = 0) {
  $('#runbar').classList.toggle('hidden', !on);
  $('#refreshBtn').disabled = on;
  $('#refreshIcon').innerHTML = on ? '<span class="spin"></span>' : '⟳';
  $('#refreshLabel').textContent = on ? 'Running' : 'Refresh';
  if (on) { $('#runText').textContent = text; $('#runProg').style.width = prog + '%'; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function attachToActiveRun() {
  if (LOCAL || !cfg.token || S.tracking) return;
  try {
    const active = (await runs(5)).find(r => r.status !== 'completed');
    if (active) await follow(active, active.event === 'schedule' ? 'Scheduled Jarvis run' : 'Jarvis is running');
  } catch { /* offline or token issue — ignore */ }
}

/* ── header ─────────────────────────────────────────────────────────── */
function renderHeader() {
  const d = S.dash; if (!d) return;
  const r = d.regime || {};
  const cls = r.label === 'RISK-ON' ? 'on' : r.label === 'NEUTRAL' ? 'neutral' : 'off';
  const pill = $('#regimePill');
  pill.innerHTML = `<span class="dot ${cls}"></span>${esc(r.label)} ${num(r.score)}`;
  pill.classList.remove('hidden');
  const prev = d.fresh?.preview ? ' · <span class="down">intraday preview</span>' : '';
  $('#stamp').innerHTML = `<b>Close ${fmtDate(d.asof)}</b>${prev}<br><span class="long">updated </span>${rel(d.run?.finished_at)}`;
  const nb = (d.buys || []).length;
  $('[data-tab="today"]').innerHTML = 'Today' + (nb ? `<span class="badge">${nb}</span>` : '');
  const no = (d.positions?.open || []).length;
  $('[data-tab="positions"]').innerHTML = 'Positions' + (no ? `<span class="badge">${no}</span>` : '');
}

/* ── Today ──────────────────────────────────────────────────────────── */
function cue(t) { return (S.dash.global?.cues || []).find(c => c.ticker === t); }
function tile(k, v, s = '', extra = '') { return `<div class="card tile" ${extra}><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`; }

function renderToday() {
  const d = S.dash, r = d.regime, b = d.breadth || {};
  const nifty = cue('^NSEI'), vix = cue('^INDIAVIX');
  const sizing = r.mult <= 0 ? 'No new buys — capital protection' : r.mult < 1 ? `Buys at ${Math.round(r.mult * 100)}% size` : 'Full position size';
  const dotc = r.label === 'RISK-ON' ? 'on' : r.label === 'NEUTRAL' ? 'neutral' : 'off';
  let h = `<div class="grid tiles">
    ${tile('Market regime', `<span class="dot ${dotc}"></span> ${esc(r.label)}`, `${num(r.score)}/100 · ${sizing}`)}
    ${nifty ? tile('Nifty 50', num(nifty.last), `<span class="${tone(nifty.chg_1d)}">${arrow(nifty.chg_1d)} ${pct(nifty.chg_1d, 2)}</span> today`) : ''}
    ${vix ? tile('India VIX', num(vix.last, 1), vix.last > 20 ? 'Elevated fear' : vix.last < 14 ? 'Calm' : 'Normal') : ''}
    ${tile('Breadth', num(b.above_50) + '%', `of stocks above 50-DMA · A/D ${num(b.advances)}/${num(b.declines)}`)}
    ${tile('Global appetite', num(d.global?.score), esc((d.global?.why || [])[0] || 'No major overnight moves'))}
  </div>`;

  if ((d.events || []).length) {
    h += `<h2>Action needed</h2><div class="grid cards">` + d.events.map(e => {
      const ic = e.type === 'SELL' ? '🔴' : e.type === 'BOOK' ? '💰' : '⏭️';
      const txt = e.type === 'SELL' ? `<b>SELL ${esc(e.symbol)}</b> @ ${inr(e.price)} — ${esc(e.why)} (<span class="${tone(e.ret)}">${pp(e.ret)}</span>, ${num(e.r, 2)}R)`
        : e.type === 'BOOK' ? `<b>Book ${Math.round((e.frac || 0) * 100)}% of ${esc(e.symbol)}</b> @ ${inr(e.price)}, move stop to cost ${inr(e.stop)}`
          : `<b>${esc(e.symbol)}</b> entry skipped — ${esc(e.why)}`;
      return `<div class="card event"><span class="ic">${ic}</span><div>${txt}</div></div>`;
    }).join('') + `</div>`;
  }

  h += `<h2>Buy signals <span class="muted">for the next session</span></h2>`;
  if ((d.buys || []).length) {
    h += `<div class="grid cards">` + d.buys.map(buyCard).join('') + `</div>`;
  } else {
    const why = r.mult <= 0
      ? `The market is <b>RISK-OFF</b>, so Jarvis is in capital-protection mode: no new buys until the regime improves. Open positions keep their stops.`
      : `No stock cleared Jarvis's bar today. Patience is a position.`;
    h += `<div class="card empty"><div class="big">🛡️</div><p>${why}</p></div>`;
  }
  if ((d.watch || []).length) {
    h += `<h2>Watchlist <span class="muted">setups forming — buy only if the trigger breaks</span></h2><div class="grid cards">` +
      d.watch.map(w => {
        const dist = w.trigger && w.close ? w.trigger / w.close - 1 : null;
        return `<div class="card sig" data-sym="${esc(w.symbol)}">
          <div class="head"><span class="sym">${esc(w.symbol)}</span><span class="score">${num(w.score)}</span></div>
          <div class="co">${esc(w.company)} · ${esc(w.cap)}cap</div>
          <div class="setup">${esc(w.setup)} forming</div>
          <div class="levels" style="grid-template-columns:repeat(3,1fr)">
            <div><div class="k">Close</div><div class="v">${inr(w.close)}</div></div>
            <div><div class="k">Trigger</div><div class="v">${inr(w.trigger)}</div></div>
            <div><div class="k">Distance</div><div class="v">${pct(dist)}</div></div>
          </div></div>`;
      }).join('') + `</div>`;
  }
  if ((d.blocked || []).length) {
    h += `<h2>Qualified but held back</h2><div class="card"><div class="tablewrap"><table><tbody>` +
      d.blocked.slice(0, 12).map(x => `<tr class="click" data-sym="${esc(x.symbol)}"><td><b>${esc(x.symbol)}</b></td><td class="ink2">${esc(x.reason)}</td></tr>`).join('') +
      `</tbody></table></div></div>`;
  }
  const op = d.positions?.open || [];
  if (op.length) {
    const pnl = op.reduce((a, p) => a + (p.pnl || 0), 0);
    h += `<h2>Open positions</h2><div class="card" style="cursor:pointer" data-goto="positions">
      ${op.length} open · unrealised <b class="${tone(pnl)}">${inr(pnl)}</b> · ${op.filter(p => (p.warn || []).length).length} with warnings → see Positions</div>`;
  }
  $('#tab-today').innerHTML = h;
}

function buyCard(b) {
  const chips = [
    `Qty ${num(b.qty)}`, `Risk ${inr(b.risk_amt)} (${num(b.risk_pct, 1)}%)`, `R:R ${num(b.rr, 1)}`,
    `Edge ${pct(b.edge?.win, 0, false)} win · ${num(b.edge?.exp, 2)}R · n=${num(b.edge?.n)}`,
    `${esc(b.cap)}cap · ${esc(b.industry)}`,
  ].map(c => `<span class="chip">${c}</span>`);
  if (b.earnings_soon) chips.push(`<span class="chip warn">⚠ Results ${fmtDate(b.earnings)} — consider half size</span>`);
  if (b.news?.red_flags?.length) chips.push(`<span class="chip crit">⚠ ${esc(b.news.red_flags.join(', '))}</span>`);
  return `<div class="card sig" data-sym="${esc(b.symbol)}">
    <div class="head"><span class="sym">${esc(b.symbol)}</span><span class="score" title="Jarvis score">${num(b.score)}</span></div>
    <div class="co">${esc(b.company)}</div>
    <div class="setup">${esc(b.setup)}${b.also?.length ? ' + ' + esc(b.also.join(', ')) : ''}</div>
    <div class="levels">
      <div><div class="k">Entry ~</div><div class="v">${inr(b.entry)}</div></div>
      <div><div class="k">Stop</div><div class="v down">${inr(b.stop)}</div></div>
      <div><div class="k">T1 · ⅓</div><div class="v up">${inr(b.t1)}</div></div>
      <div><div class="k">T2</div><div class="v up">${inr(b.t2)}</div></div>
    </div>
    <div class="meta">${chips.join('')}</div>
    <div class="meta"><span class="muted">Skip if it opens above ${inr(b.skip_above)}</span></div>
    <div class="actions"><button class="btn small" data-bought="${esc(b.symbol)}">I bought it</button></div>
  </div>`;
}

/* ── Positions ──────────────────────────────────────────────────────── */
function renderPositions() {
  const p = S.dash.positions || {}, op = p.open || [], tr = p.track;
  const pnl = op.reduce((a, x) => a + (x.pnl || 0), 0);
  let h = `<div class="grid tiles">
    ${tile('Open', num(op.length), `${(p.pending || []).length} pending entries`)}
    ${tile('Unrealised P&L', `<span class="${tone(pnl)}">${inr(pnl)}</span>`, 'marked at last close')}
    ${tile('Closed trades', tr ? num(tr.n) : '0', tr ? `realised ${inr(tr.pnl)}` : 'track record builds over time')}
    ${tile('Win rate', tr ? pct(tr.win, 0, false) : '–', tr ? `avg ${pp(tr.avg_ret)} · ${num(tr.avg_r, 2)}R` : '')}
  </div>
  <div class="actions" style="justify-content:flex-start;margin-top:12px"><button class="btn primary" id="addTradeBtn">＋ Add my trade</button></div>`;

  h += `<h2>Open positions</h2>`;
  if (op.length) {
    h += `<div class="card"><div class="tablewrap"><table><thead><tr>
      <th>Stock</th><th class="n">Qty</th><th class="n">Entry</th><th class="n">Last</th><th class="n">P&amp;L</th>
      <th class="n">Stop now</th><th class="n">Days</th><th>Status</th><th></th></tr></thead><tbody>` +
      op.map(x => `<tr class="click" data-sym="${esc(x.symbol)}">
        <td class="symcell"><b>${esc(x.symbol)}</b><span>${esc(x.source === 'manual' ? 'your trade' : 'Jarvis · ' + x.setup)} · ${fmtDate(x.entry_date)}</span></td>
        <td class="n">${num(x.qty)}</td><td class="n">${inr(x.entry)}</td><td class="n">${inr(x.last)}</td>
        <td class="n ${tone(x.ret)}">${pct(x.ret)}<br><span class="muted">${inr(x.pnl)}</span></td>
        <td class="n">${inr(x.stop)}</td><td class="n">${num(x.days)}</td>
        <td>${x.partial ? '<span class="chip good">T1 booked</span> ' : ''}${(x.warn || []).map(w => `<span class="chip warn">${esc(w)}</span>`).join(' ')}</td>
        <td><button class="btn small" data-close="${x.id}" data-closesym="${esc(x.symbol)}" data-last="${x.last ?? ''}">Close</button></td>
      </tr>`).join('') + `</tbody></table></div></div>`;
  } else {
    h += `<div class="card empty">No open positions. Jarvis paper-tracks every BUY signal here, and you can add your own trades.</div>`;
  }
  if ((p.pending || []).length) {
    h += `<h2>Pending entries <span class="muted">fill at the next open</span></h2><div class="card"><div class="tablewrap"><table><thead><tr>
      <th>Stock</th><th>Signal</th><th class="n">Signal close</th><th class="n">Stop</th><th class="n">Qty</th></tr></thead><tbody>` +
      p.pending.map(x => `<tr class="click" data-sym="${esc(x.symbol)}"><td><b>${esc(x.symbol)}</b></td><td>${fmtDate(x.signal_date)}</td>
        <td class="n">${inr(x.signal_close)}</td><td class="n">${inr(x.stop)}</td><td class="n">${num(x.qty)}</td></tr>`).join('') +
      `</tbody></table></div></div>`;
  }
  if ((p.closed || []).length) {
    h += `<h2>Closed trades</h2><div class="card"><div class="tablewrap"><table><thead><tr>
      <th>Stock</th><th>Entry</th><th>Exit</th><th class="n">Buy</th><th class="n">Sell</th><th class="n">Return</th><th class="n">R</th><th>Reason</th></tr></thead><tbody>` +
      p.closed.map(x => `<tr class="click" data-sym="${esc(x.symbol)}"><td class="symcell"><b>${esc(x.symbol)}</b><span>${esc(x.source === 'manual' ? 'your trade' : x.setup)}</span></td>
        <td>${fmtDate(x.entry_date)}</td><td>${fmtDate(x.exit_date)}</td><td class="n">${inr(x.entry)}</td><td class="n">${inr(x.exit_price)}</td>
        <td class="n ${tone(x.ret_pct)}">${pp(x.ret_pct)}</td><td class="n">${num(x.r, 2)}</td><td class="ink2">${esc(x.exit_reason)}</td></tr>`).join('') +
      `</tbody></table></div></div>`;
  }
  $('#tab-positions').innerHTML = h;
}

/* ── Market ─────────────────────────────────────────────────────────── */
function renderMarket() {
  const d = S.dash, r = d.regime;
  let h = `<div class="grid tiles">
    ${tile('Regime score', num(r.score), esc(r.label))}
    ${tile('Nifty trend', num(r.nifty), 'of 100 · 45% weight')}
    ${tile('Volatility', num(r.vix_score), `VIX ${num(r.vix, 1)} · 20% weight`)}
    ${tile('Breadth', num(r.breadth), '% > 50-DMA · 20% weight')}
    ${tile('Global', num(r.global), 'S&P trend · 15% weight')}
  </div>`;
  h += `<h2>Regime score &amp; breadth <span class="muted">last 12 months</span></h2><div class="card"><div class="chart" id="regChart"></div></div>`;
  h += `<h2>Global cues <span class="muted">overnight score ${num(d.global?.score)}/100</span></h2>`;
  if ((d.global?.why || []).length) h += `<div class="meta" style="margin:-4px 0 10px">${d.global.why.map(w => `<span class="chip">${esc(w)}</span>`).join('')}</div>`;
  h += `<div class="card"><div class="tablewrap"><table><thead><tr><th>Market</th><th class="n">Last</th><th class="n">1 day</th><th class="n">5 days</th><th>Trend</th><th class="hide-sm">As of</th></tr></thead><tbody>` +
    (d.global?.cues || []).map(c => `<tr><td>${esc(c.name)}</td><td class="n">${num(c.last, 2)}</td>
      <td class="n ${tone(c.chg_1d)}">${arrow(c.chg_1d)} ${pct(c.chg_1d, 2)}</td><td class="n ${tone(c.chg_5d)}">${pct(c.chg_5d, 2)}</td>
      <td>${c.above_50dma ? '↗ above 50-DMA' : '↘ below 50-DMA'}</td><td class="hide-sm muted">${fmtDate(c.date)}</td></tr>`).join('') +
    `</tbody></table></div></div>`;
  h += `<h2>Sector rotation <span class="muted">median 1-month return of member stocks</span></h2><div class="card"><div class="chart" id="secChart"></div></div>`;
  const news = d.news || {};
  if ((news.india || []).length || (news.global || []).length) {
    h += `<h2>Headlines <span class="muted">mood ${num(news.score, 2)}</span></h2><div class="grid cards">
      <div class="card"><b>India</b><ul class="ink2">${(news.india || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card"><b>Global</b><ul class="ink2">${(news.global || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
  }
  $('#tab-market').innerHTML = h;

  const rh = d.regime_history || [];
  if (rh.length) {
    lineChart($('#regChart'), {
      dates: rh.map(x => x[0]),
      series: [{ name: 'Regime score', color: 'var(--s1)', values: rh.map(x => x[1]) },
               { name: 'Breadth %', color: 'var(--s2)', values: rh.map(x => x[2]) }],
      yFmt: v => num(v), domain: [0, 100], height: 240,
      refs: [{ y: 60, label: 'Risk-on ≥ 60', color: 'var(--muted)' }, { y: 40, label: 'Risk-off < 40', color: 'var(--muted)' }],
    });
  }
  const sec = (d.sectors || []).filter(s => fin(s.ret_21)).sort((a, b) => b.ret_21 - a.ret_21);
  divergingBars($('#secChart'), sec.map(s => ({ label: s.industry, value: s.ret_21,
    tip: `1M ${pct(s.ret_21)} · RS 3M ${pct(s.rs_63)} · ${num(s.n)} stocks · score ${num(s.score)}` })), v => pct(v));
}

/* ── Stocks ─────────────────────────────────────────────────────────── */
const STOCK_COLS = [
  ['symbol', 'Stock', 0], ['close', 'Close', 1], ['chg_1d', '1D', 1], ['ret_21', '1M', 1], ['ret_63', '3M', 1],
  ['dist_52wh', 'vs 52wH', 1], ['score', 'Score', 1], ['tech', 'Tech', 1], ['mom', 'Mom', 1], ['fund', 'Fund', 1],
  ['rsi', 'RSI', 1], ['adx', 'ADX', 1], ['signal', 'Setups', 0],
];
function renderStocks() {
  const f = S.filt;
  const caps = ['All', 'Large', 'Mid', 'Small'];
  $('#tab-stocks').innerHTML = `<div class="filters">
      <input type="search" id="stockQ" placeholder="Search 350 stocks, sectors…" value="${esc(f.q)}" aria-label="Search stocks">
      <div class="seg" role="group" aria-label="Market cap">${caps.map(c => `<button data-cap="${c}" aria-pressed="${f.cap === c}">${c}</button>`).join('')}</div>
      <div class="seg"><button id="sigOnly" aria-pressed="${f.sig}">Setups only</button></div>
    </div><div class="card" style="padding:0"><div class="tablewrap" id="stockTable"></div></div>
    <p class="muted" style="font-size:12px">Score = Jarvis composite (momentum 60% · technical 20% · setup edge 20%, plus fundamentals, sector and news). Tap a stock for its chart and full analysis.</p>`;
  renderStockTable();
}
function renderStockTable() {
  const f = S.filt, sm = setupMap(), q = f.q.trim().toLowerCase();
  let rows = (S.dash.stocks || []).filter(s =>
    (f.cap === 'All' || s.cap === f.cap) && (!f.sig || (s.fired || []).length || (s.near || []).length) &&
    (!q || s.symbol.toLowerCase().includes(q) || (s.company || '').toLowerCase().includes(q) || (s.industry || '').toLowerCase().includes(q)));
  const { key, dir } = S.sort;
  rows = rows.slice().sort((a, b) => {
    const va = key === 'signal' ? (a.fired || []).length * 10 + (a.near || []).length : a[key];
    const vb = key === 'signal' ? (b.fired || []).length * 10 + (b.near || []).length : b[key];
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return (fin(va) ? (fin(vb) ? dir * (va - vb) : -1) : 1);
  });
  const th = STOCK_COLS.map(([k, label, n]) =>
    `<th class="sortable ${n ? 'n' : ''}" data-sort="${k}">${label}${S.sort.key === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('');
  $('#stockTable').innerHTML = `<table><thead><tr>${th}</tr></thead><tbody>` + rows.map(s => {
    const tags = (s.fired || []).map(k => `<span class="chip good">${esc(sm[k]?.name || k)}</span>`)
      .concat((s.near || []).slice(0, 2).map(k => `<span class="chip">${esc(sm[k]?.name || k)}…</span>`)).join(' ');
    return `<tr class="click" data-sym="${esc(s.symbol)}">
      <td class="symcell"><b>${esc(s.symbol)}</b><span>${esc(s.company)} · ${esc(s.cap)}</span></td>
      <td class="n">${inr(s.close)}</td><td class="n ${tone(s.chg_1d)}">${pct(s.chg_1d)}</td>
      <td class="n ${tone(s.ret_21)}">${pct(s.ret_21)}</td><td class="n ${tone(s.ret_63)}">${pct(s.ret_63)}</td>
      <td class="n">${pct(s.dist_52wh)}</td><td class="n"><b>${num(s.score)}</b></td><td class="n">${num(s.tech)}</td>
      <td class="n">${num(s.mom)}</td><td class="n">${num(s.fund)}</td><td class="n">${num(s.rsi)}</td><td class="n">${num(s.adx)}</td>
      <td>${tags || '<span class="muted">–</span>'}</td></tr>`;
  }).join('') + `</tbody></table>` + (rows.length ? '' : `<div class="empty">No stocks match.</div>`);
}

/* ── Setups ─────────────────────────────────────────────────────────── */
function renderSetups() {
  const ss = (S.dash.setups || []).slice().sort((a, b) => b.exp - a.exp);
  $('#tab-setups').innerHTML = `<h2>Setup library <span class="muted">every setup backtested on every stock, 15 years, after costs</span></h2>
    <p class="ink2" style="margin-top:0">A setup is switched off automatically when its shrunk expectancy falls below +0.05R. Edges are re-learned every Saturday.</p>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>Setup</th><th>Type</th><th class="n">Trades</th><th class="n">Win</th>
      <th class="n">Expectancy</th><th class="n">Profit factor</th><th class="n">Avg trade</th><th class="n">Avg days</th><th>Status</th></tr></thead><tbody>` +
    ss.map(s => `<tr><td class="symcell"><b>${esc(s.name)}</b><span style="max-width:340px;white-space:normal">${esc(s.idea)}</span></td>
      <td>${esc(s.kind)}</td><td class="n">${num(s.trades)}</td><td class="n">${pct(s.win, 0, false)}</td>
      <td class="n ${tone(s.exp)}">${num(s.exp, 2)}R</td><td class="n">${num(s.pf, 2)}</td><td class="n ${tone(s.avg_ret)}">${pp(s.avg_ret, 2)}</td>
      <td class="n">${num(s.avg_bars)}</td><td>${s.enabled ? '<span class="chip good">✓ active</span>' : '<span class="chip crit">✕ off</span>'}</td></tr>`).join('') +
    `</tbody></table></div></div>`;
}

/* ── Backtest ───────────────────────────────────────────────────────── */
function renderBacktest() {
  const bt = S.bt;
  if (!bt) { $('#tab-backtest').innerHTML = `<div class="card empty">No backtest yet — it is produced by the weekly maintenance run.</div>`; return; }
  const j = bt.metrics.jarvis, n = bt.metrics.nifty50, n5 = bt.metrics.nifty500, ts = bt.trade_stats || {};
  let h = `<h2>10-year portfolio backtest <span class="muted">${fmtDate(bt.start, true)} → ${fmtDate(bt.end, true)} · re-run ${rel(bt.generated_at)}</span></h2>
    <div class="grid tiles">
      ${tile('CAGR', pct(j.CAGR), `Nifty 50 ${pct(n.CAGR)}${n5 ? ' · Nifty 500 ' + pct(n5.CAGR) : ''}`)}
      ${tile('Max drawdown', pct(j['Max drawdown']), `Nifty 50 ${pct(n['Max drawdown'])}`)}
      ${tile('Sharpe', num(j.Sharpe, 2), `Nifty 50 ${num(n.Sharpe, 2)}`)}
      ${tile('Win rate', pct(ts['Win rate'], 0, false), `${num(ts.Trades)} trades · PF ${num(ts['Profit factor'], 2)}`)}
      ${tile('Per trade', num(ts['Avg R'], 2) + 'R', `avg hold ${num(ts['Avg hold (days)'])} days`)}
    </div>
    <h2>Growth of ${inrShort(bt.capital)} <span class="muted">log scale</span></h2><div class="card"><div class="chart" id="eqChart"></div></div>
    <h2>Drawdown</h2><div class="card"><div class="chart" id="ddChart"></div></div>
    <h2>Year by year</h2><div class="card"><div class="tablewrap"><table><thead><tr><th>Year</th><th class="n">Jarvis</th><th class="n">Nifty 50</th><th class="n">Difference</th></tr></thead><tbody>` +
    bt.yearly.map(y => `<tr><td>${y.year}</td><td class="n ${tone(y.jarvis)}">${pct(y.jarvis)}</td><td class="n ${tone(y.nifty50)}">${pct(y.nifty50)}</td>
      <td class="n ${tone(y.jarvis - y.nifty50)}">${pct(y.jarvis - y.nifty50)}</td></tr>`).join('') + `</tbody></table></div></div>
    <h2>Contribution by setup</h2><div class="card"><div class="tablewrap"><table><thead><tr><th>Setup</th><th class="n">Trades</th><th class="n">Win</th><th class="n">Avg R</th><th class="n">P&amp;L</th></tr></thead><tbody>` +
    (bt.by_setup || []).map(s => `<tr><td>${esc(s.setup)}</td><td class="n">${num(s.trades)}</td><td class="n">${pct(s.win, 0, false)}</td>
      <td class="n">${num(s.avg_r, 2)}</td><td class="n ${tone(s.pnl)}">${inr(s.pnl)}</td></tr>`).join('') + `</tbody></table></div></div>
    <h2>Latest backtest trades</h2><div class="card"><div class="tablewrap"><table><thead><tr><th>Stock</th><th>Setup</th><th>Entry</th><th>Exit</th><th class="n">Return</th><th class="n">R</th><th>Exit reason</th></tr></thead><tbody>` +
    (bt.recent || []).slice().reverse().map(t => `<tr><td><b>${esc(t.symbol)}</b></td><td>${esc(t.setup)}</td><td>${fmtDate(t.entry_date, true)}</td>
      <td>${fmtDate(t.exit_date, true)}</td><td class="n ${tone(t.ret_pct)}">${pp(t.ret_pct)}</td><td class="n">${num(t.r, 2)}</td><td class="ink2">${esc(t.reason)}</td></tr>`).join('') +
    `</tbody></table></div></div>
    <p class="muted" style="font-size:12.5px">Honest caveats: the universe is today's index members (survivorship bias flatters results, especially small caps);
    Nifty figures are price indices without ~1.2%/yr dividends; fundamentals and news are not in the backtest; Yahoo's adjusted prices
    drift between downloads, so treat any single figure as roughly ±3 points. Past performance does not guarantee future results.</p>`;
  $('#tab-backtest').innerHTML = h;

  const cols = bt.curve_cols, names = { jarvis: 'Jarvis', nifty50: 'Nifty 50', nifty500: 'Nifty 500' };
  const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
  const dates = bt.curve.map(r => r[0]);
  const series = cols.map((c, i) => ({ name: names[c] || c, color: colors[i], values: bt.curve.map(r => r[i + 1]) }));
  lineChart($('#eqChart'), { dates, series, log: true, yFmt: inrShort, height: 300 });
  const dd = series.slice(0, 2).map(s => {
    let peak = -Infinity;
    return { ...s, values: s.values.map(v => { if (!fin(v)) return null; peak = Math.max(peak, v); return v / peak - 1; }) };
  });
  lineChart($('#ddChart'), { dates, series: dd, yFmt: v => pct(v, 0), height: 200, refs: [{ y: 0, label: '', color: 'var(--axis)' }] });
}

/* ── Messages ───────────────────────────────────────────────────────── */
function waFormat(s) {
  return esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
}
function renderMessages() {
  const ms = S.msgs?.messages || [];
  const icon = { scan: '🤖', brief: '☀️', risk: '⚡', maintenance: '🛠️', holiday: '📅', error: '⚠️', test: '✉️' };
  $('#tab-messages').innerHTML = `<h2>Messages <span class="muted">everything Jarvis sends to WhatsApp, kept here too</span></h2>` +
    (ms.length ? `<div class="grid" style="gap:12px">` + ms.map(m => `<div class="card msg"><div class="when">${icon[m.kind] || '•'} <b>${esc(m.kind)}</b> · ${m.time ? fmtDate(m.time, true) + ' ' + new Date(m.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</div>${waFormat(m.text)}</div>`).join('') + `</div>`
      : `<div class="card empty">No messages yet.</div>`);
}

/* ── stock drawer ───────────────────────────────────────────────────── */
async function openStock(sym) {
  const s = (S.dash.stocks || []).find(x => x.symbol === sym);
  const buy = (S.dash.buys || []).find(x => x.symbol === sym);
  const pos = (S.dash.positions?.open || []).find(x => x.symbol === sym);
  const sm = setupMap();
  S.drawerSym = sym;
  const dr = $('#drawer');
  const kv = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  let h = `<div class="dhead"><div style="flex:1;min-width:0"><h3>${esc(sym)}</h3>
      <div class="ink2" style="font-size:13px">${esc(s?.company || '')}${s ? ` · ${esc(s.industry)} · ${esc(s.cap)}cap` : ''}</div></div>
      <button class="btn icon-btn" id="drClose" aria-label="Close">✕</button></div>`;
  if (s) {
    h += `<div style="font-size:26px;font-weight:800">${inr(s.close)} <span style="font-size:15px" class="${tone(s.chg_1d)}">${arrow(s.chg_1d)} ${pct(s.chg_1d, 2)}</span></div>`;
  }
  h += `<div class="chart" id="pxChart" style="margin:12px 0"><div class="muted">Loading chart…</div></div>`;
  if (buy) {
    h += `<h2>Buy plan</h2>${buyCard(buy)}`;
  }
  if (pos) {
    h += `<h2>Your position</h2><div class="kv">${kv('Entry', inr(pos.entry))}${kv('Qty', num(pos.qty))}${kv('Last', inr(pos.last))}
      ${kv('P&L', `<span class="${tone(pos.ret)}">${pct(pos.ret)} · ${inr(pos.pnl)}</span>`)}${kv('Stop now', inr(pos.stop))}${kv('Days held', num(pos.days))}</div>`;
    if ((pos.warn || []).length) h += `<div class="meta">${pos.warn.map(w => `<span class="chip warn">⚠ ${esc(w)}</span>`).join('')}</div>`;
  }
  if (s) {
    h += `<h2>Scores</h2><div class="kv">${kv('Jarvis score', num(s.score))}${kv('Core', num(s.core))}${kv('Technical', num(s.tech))}
      ${kv('Momentum', num(s.mom))}${kv('Fundamentals', num(s.fund))}${kv('Sector', num(s.sector_score))}</div>
      <h2>Technicals</h2><div class="kv">${kv('1 month', `<span class="${tone(s.ret_21)}">${pct(s.ret_21)}</span>`)}${kv('3 months', `<span class="${tone(s.ret_63)}">${pct(s.ret_63)}</span>`)}
      ${kv('6 months', `<span class="${tone(s.ret_126)}">${pct(s.ret_126)}</span>`)}${kv('From 52w high', pct(s.dist_52wh))}${kv('RSI 14', num(s.rsi))}
      ${kv('ADX', num(s.adx))}${kv('ATR', num(s.atr_pct, 1) + '%')}${kv('Volume', num(s.vol_ratio, 1) + '× avg')}
      ${kv('Supertrend', s.trend_up ? '↗ Up' : '↘ Down')}${kv('200-DMA', s.above_200 ? 'Above' : 'Below')}${kv('Turnover', '₹' + num(s.turnover_cr) + ' cr/day')}</div>
      <h2>Fundamentals</h2><div class="kv">${kv('P/E', num(s.pe, 1))}${kv('ROE', pct(s.roe, 1, false))}${kv('Next results', fmtDate(s.next_earnings, true))}</div>
      ${s.fund_notes ? `<p class="ink2">${esc(s.fund_notes)}</p>` : ''}
      <h2>Setups</h2>` +
      ((s.fired || []).length || (s.near || []).length ? `<div class="tablewrap"><table><thead><tr><th>Setup</th><th>State</th><th class="n">Win</th><th class="n">Expectancy</th><th class="n">Trades</th></tr></thead><tbody>` +
        (s.fired || []).map(k => [k, '<span class="chip good">triggered</span>']).concat((s.near || []).map(k => [k, '<span class="chip">forming</span>']))
          .map(([k, st]) => `<tr><td>${esc(sm[k]?.name || k)}</td><td>${st}</td><td class="n">${pct(sm[k]?.win, 0, false)}</td><td class="n">${num(sm[k]?.exp, 2)}R</td><td class="n">${num(sm[k]?.trades)}</td></tr>`).join('') +
        `</tbody></table></div>` : `<p class="ink2">No setup triggered or forming right now.</p>`);
  }
  h += `<div class="actions" style="justify-content:flex-start;margin-top:16px">
    <button class="btn primary" data-bought="${esc(sym)}">＋ Add as my trade</button>
    <a class="btn" href="https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(sym)}" target="_blank" rel="noopener">TradingView ↗</a></div>`;
  dr.innerHTML = h;
  dr.classList.add('open'); $('#scrim').classList.add('open');
  dr.scrollTop = 0;
  if (!history.state?.drawer) history.pushState({ drawer: 1 }, '');
  $('#drClose').onclick = () => history.back();

  try {
    const c = await getState(chartFile(sym));
    if (S.drawerSym !== sym) return;
    const refs = [];
    const plan = buy || (pos ? { entry: pos.entry, stop: pos.stop } : null);
    if (plan) {
      refs.push({ y: plan.entry, label: 'Entry ' + inr(plan.entry), color: 'var(--ink-2)' });
      refs.push({ y: plan.stop, label: 'Stop ' + inr(plan.stop), color: 'var(--crit)' });
      if (plan.t1) refs.push({ y: plan.t1, label: 'T1 ' + inr(plan.t1), color: 'var(--good)' });
    }
    lineChart($('#pxChart'), {
      dates: c.d, height: 280, yFmt: v => inr(v), refs,
      series: [{ name: 'Close', color: 'var(--s1)', values: c.c }, { name: 'EMA 20', color: 'var(--s2)', values: c.e20 },
               { name: 'EMA 50', color: 'var(--s3)', values: c.e50 }, { name: 'SMA 200', color: 'var(--s4)', values: c.s200 }],
    });
  } catch {
    $('#pxChart').innerHTML = '<div class="muted">Chart unavailable for this stock.</div>';
  }
}
function closeDrawer() {
  $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); S.drawerSym = null;
}

/* ── charts ─────────────────────────────────────────────────────────── */
const NS = 'http://www.w3.org/2000/svg';
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo && v <= hi) out.push(v); }
  }
  return out.length >= 2 ? out : [lo, hi];
}

function lineChart(host, o) {
  if (!host) return;
  const { dates, series, log = false, height = 260, yFmt = v => v, refs = [], domain } = o;
  const W = Math.max(300, host.clientWidth || host.parentElement.clientWidth || 600);
  const multi = series.length >= 2;
  const endW = multi ? Math.min(92, W * 0.2) : 12;
  const m = { l: 56, r: endW, t: 10, b: 26 };
  const H = height, pw = W - m.l - m.r, ph = H - m.t - m.b, n = dates.length;
  const tf = log ? Math.log : (v => v);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.values) if (fin(v) && (!log || v > 0)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (const r of refs) if (fin(r.y)) { lo = Math.min(lo, r.y); hi = Math.max(hi, r.y); }
  if (domain) { lo = domain[0]; hi = domain[1]; }
  if (!fin(lo)) { host.innerHTML = '<div class="muted">No data</div>'; return; }
  if (!log) { const pad = (hi - lo) * 0.06 || 1; lo = domain ? lo : lo - pad; hi = domain ? hi : hi + pad; }
  else { lo *= 0.95; hi *= 1.05; }
  const X = i => m.l + (n <= 1 ? pw / 2 : i / (n - 1) * pw);
  const Y = v => m.t + ph - (tf(v) - tf(lo)) / (tf(hi) - tf(lo)) * ph;

  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))} chart">`;
  const yt = log ? logTicks(lo, hi) : niceTicks(lo, hi, 4);
  for (const v of yt) svg += `<line class="gridline" x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(yFmt(v))}</text>`;
  svg += `<line class="baseline" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
  // x ticks at month/year boundaries
  const span = n ? (new Date(dates[n - 1]) - new Date(dates[0])) / 864e5 : 0;
  const byYear = span > 900, maxT = Math.max(2, Math.floor(pw / 70));
  const marks = [];
  for (let i = 1; i < n; i++) {
    const a = dates[i - 1], b = dates[i];
    if (byYear ? a.slice(0, 4) !== b.slice(0, 4) : a.slice(0, 7) !== b.slice(0, 7)) marks.push(i);
  }
  const every = Math.ceil(marks.length / maxT) || 1;
  marks.filter((_, k) => k % every === 0).forEach(i => {
    const d = new Date(dates[i] + 'T00:00:00');
    const lab = byYear ? d.getFullYear() : d.toLocaleDateString('en-IN', { month: 'short' }) + (d.getMonth() === 0 ? ' ' + String(d.getFullYear()).slice(2) : '');
    svg += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${lab}</text>`;
  });
  for (const r of refs) {
    if (!fin(r.y)) continue;
    svg += `<line class="ref" x1="${m.l}" x2="${m.l + pw}" y1="${Y(r.y)}" y2="${Y(r.y)}" style="stroke:${r.color}"/>`;
    if (r.label) svg += `<text class="reflabel" x="${m.l + 6}" y="${Y(r.y) - 5}" style="fill:${r.color}">${esc(r.label)}</text>`;
  }
  for (const s of series) {
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (!fin(v) || (log && v <= 0)) { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true;
    });
    svg += `<path class="line" d="${d}" style="stroke:${s.color}"/>`;
  }
  // direct end labels (≤ 4 series), nudged apart so they never collide
  if (multi && series.length <= 4) {
    const ends = series.map(s => {
      let i = s.values.length - 1; while (i >= 0 && !fin(s.values[i])) i--;
      return { s, y: i >= 0 ? Y(s.values[i]) : null };
    }).filter(e => e.y !== null).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
    for (const e of ends) svg += `<text class="endlabel" x="${m.l + pw + 6}" y="${e.y + 4}">${esc(e.s.name)}</text>`;
  }
  svg += `<line class="cross hidden" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/><g class="dots"></g>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></svg>`;

  const legend = multi ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  // table-view twin, sampled
  const stepT = Math.max(1, Math.ceil(n / 60));
  const idxs = []; for (let i = 0; i < n; i += stepT) idxs.push(i); if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  const table = `<details class="dataview"><summary>View data</summary><div class="tablewrap"><table><thead><tr><th>Date</th>${series.map(s => `<th class="n">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>` +
    idxs.reverse().map(i => `<tr><td>${fmtDate(dates[i], true)}</td>${series.map(s => `<td class="n">${fin(s.values[i]) ? esc(yFmt(s.values[i])) : '–'}</td>`).join('')}</tr>`).join('') +
    `</tbody></table></div></details>`;
  host.innerHTML = legend + svg + table;
  host.tabIndex = 0;

  const svgEl = $('svg', host), cross = $('.cross', host), dots = $('.dots', host);
  let tip = $('.tip', host); if (!tip) { tip = document.createElement('div'); tip.className = 'tip hidden'; host.appendChild(tip); }
  const show = i => {
    i = Math.max(0, Math.min(n - 1, i)); host._i = i;
    const x = X(i);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.classList.remove('hidden');
    dots.innerHTML = series.map(s => fin(s.values[i]) ? `<circle cx="${x}" cy="${Y(s.values[i])}" r="4" style="fill:${s.color};stroke:var(--surface);stroke-width:2"/>` : '').join('');
    tip.innerHTML = `<div class="t">${fmtDate(dates[i], true)}</div>` + series.map(s =>
      `<div class="r"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${fin(s.values[i]) ? esc(yFmt(s.values[i])) : '–'}</b></div>`).join('');
    tip.classList.remove('hidden');
    const scale = svgEl.getBoundingClientRect().width / W;
    const px = x * scale, tw = tip.offsetWidth;
    tip.style.left = (px + 14 + tw > host.clientWidth ? px - tw - 14 : px + 14) + 'px';
    tip.style.top = (legend ? 30 : 4) + 'px';
  };
  const hide = () => { cross.classList.add('hidden'); dots.innerHTML = ''; tip.classList.add('hidden'); };
  const hit = $('.hit', host);
  const fromEvt = e => {
    const r = svgEl.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
    return Math.round((x - m.l) / pw * (n - 1));
  };
  hit.addEventListener('pointermove', e => show(fromEvt(e)));
  hit.addEventListener('pointerdown', e => show(fromEvt(e)));
  hit.addEventListener('pointerleave', hide);
  host.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show((host._i ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1)); }
    if (e.key === 'Escape') hide();
  });
  host.addEventListener('blur', hide);
}

function divergingBars(host, rows, fmt) {
  if (!host || !rows.length) return;
  const W = Math.max(300, host.clientWidth || 600), rowH = 24, bar = 14;
  const labW = Math.min(210, W * 0.42), valW = 56;
  const H = rows.length * rowH + 8;
  const max = Math.max(...rows.map(r => Math.abs(r.value))) || 1;
  const anyNeg = rows.some(r => r.value < 0);
  const plotL = labW + 8 + (anyNeg ? valW : 0), plotR = W - valW;
  const zero = anyNeg ? plotL + (plotR - plotL) / 2 : plotL;
  const scale = (anyNeg ? (plotR - plotL) / 2 : plotR - plotL) / max;
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Sector one-month returns">`;
  svg += `<line class="baseline" x1="${zero}" x2="${zero}" y1="0" y2="${H}"/>`;
  rows.forEach((r, i) => {
    const y = 4 + i * rowH + (rowH - bar) / 2, len = Math.max(1, Math.abs(r.value) * scale), rr = Math.min(4, len);
    const pos = r.value >= 0, x1 = pos ? zero + len : zero - len;
    const path = pos
      ? `M${zero} ${y}H${x1 - rr}Q${x1} ${y} ${x1} ${y + rr}V${y + bar - rr}Q${x1} ${y + bar} ${x1 - rr} ${y + bar}H${zero}Z`
      : `M${zero} ${y}H${x1 + rr}Q${x1} ${y} ${x1} ${y + rr}V${y + bar - rr}Q${x1} ${y + bar} ${x1 + rr} ${y + bar}H${zero}Z`;
    svg += `<g class="b" data-i="${i}"><rect x="0" y="${4 + i * rowH}" width="${W}" height="${rowH}" fill="transparent"/>
      <text x="${labW}" y="${y + bar - 3}" text-anchor="end" style="fill:var(--ink-2);font-size:12px">${esc(r.label.length > 32 ? r.label.slice(0, 31) + '…' : r.label)}</text>
      <path d="${path}" style="fill:${pos ? 'var(--s1)' : 'var(--neg)'}"/>
      <text x="${pos ? x1 + 6 : x1 - 6}" y="${y + bar - 3}" text-anchor="${pos ? 'start' : 'end'}" style="fill:var(--ink-2)">${esc(fmt(r.value))}</text></g>`;
  });
  svg += `</svg>`;
  host.innerHTML = svg;
  let tip = document.createElement('div'); tip.className = 'tip hidden'; host.appendChild(tip);
  $$('.b', host).forEach(g => {
    g.addEventListener('pointerenter', () => {
      const r = rows[+g.dataset.i];
      tip.innerHTML = `<div class="t">${esc(r.label)}</div><div>${esc(r.tip || fmt(r.value))}</div>`;
      tip.classList.remove('hidden');
      const box = g.getBoundingClientRect(), hb = host.getBoundingClientRect();
      tip.style.left = Math.min(hb.width - tip.offsetWidth, Math.max(0, labW)) + 'px';
      tip.style.top = (box.bottom - hb.top + 4) + 'px';
    });
    g.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  });
}

/* ── tabs, onboarding, dialogs ──────────────────────────────────────── */
const RENDER = { today: renderToday, positions: renderPositions, market: renderMarket, stocks: renderStocks,
                 setups: renderSetups, backtest: renderBacktest, messages: renderMessages };
function renderAll() {
  renderHeader();
  for (const [k, f] of Object.entries(RENDER)) { try { f(); } catch (e) { console.error(k, e); $('#tab-' + k).innerHTML = `<div class="card empty">Could not render this view.</div>`; } }
  $('#symList').innerHTML = (S.dash.stocks || []).map(s => `<option value="${esc(s.symbol)}">${esc(s.company)}</option>`).join('');
}
function selectTab(t) {
  S.tab = t;
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('section.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
  if (S.dash && (t === 'market' || t === 'backtest')) RENDER[t]();   // charts need a visible width
  localStorageSet('jarvis.tab', t);
}

function showOnboarding() {
  $$('section.tab').forEach(s => s.classList.remove('active'));
  const o = $('#onboard'); o.classList.add('active');
  o.innerHTML = `<div class="card" style="max-width:620px;margin:20px auto">
    <h2 style="margin-top:0">👋 Connect Jarvis</h2>
    <p class="ink2">Your signals, positions and market data live in your <b>private</b> GitHub repo
    <code>${esc(cfg.owner)}/${esc(cfg.repo)}</code>. Give this device a token once and it stays connected.</p>
    <ol class="steps">
      <li>Create a <a href="${tokenUrl()}" target="_blank" rel="noopener">fine-grained token</a> → <i>Only select repositories</i> → <b>${esc(cfg.repo)}</b>.</li>
      <li>Permissions: <b>Actions: Read and write</b>, <b>Contents: Read-only</b>.</li>
      <li>Paste it in Settings. Done — tap <b>Refresh</b> any time for fresh data.</li>
    </ol>
    <button class="btn primary" id="obConnect">Open settings</button></div>`;
  $('#obConnect').onclick = openSettings;
}
function showNoData() {
  $$('section.tab').forEach(s => s.classList.remove('active'));
  const o = $('#onboard'); o.classList.add('active');
  o.innerHTML = `<div class="card empty" style="max-width:620px;margin:20px auto"><div class="big">🚀</div>
    <p>Connected — but Jarvis hasn't saved any data yet. Tap <b>Refresh</b> to run it now (about 3 minutes).</p></div>`;
}
function tokenUrl() {
  const p = new URLSearchParams({ name: 'Jarvis dashboard', description: 'Jarvis web app: read data, start runs',
                                  target_name: cfg.owner, expires_in: '365', actions: 'write', contents: 'read' });
  return 'https://github.com/settings/personal-access-tokens/new?' + p;
}
function applyTheme() {
  if (cfg.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', cfg.theme);
}
function openSettings() {
  $('#cfgOwner').value = cfg.owner; $('#cfgRepo').value = cfg.repo; $('#cfgToken').value = cfg.token;
  $('#cfgTheme').value = cfg.theme; $('#repoName2').textContent = cfg.repo; $('#tokenLink').href = tokenUrl();
  $('#cfgMsg').innerHTML = cfg.token && !LOCAL ? `Logs &amp; history: <a href="https://github.com/${esc(cfg.owner)}/${esc(cfg.repo)}/actions" target="_blank" rel="noopener">GitHub Actions ↗</a>` : '';
  const d = $('#settingsDlg'); if (!d.open) d.showModal();
}
async function saveSettings() {
  cfg = { owner: $('#cfgOwner').value.trim() || DEFAULTS.owner, repo: $('#cfgRepo').value.trim() || DEFAULTS.repo,
          token: $('#cfgToken').value.trim(), theme: $('#cfgTheme').value };
  localStorageSet(LS_KEY, JSON.stringify(cfg));
  applyTheme();
  if (!cfg.token) { $('#cfgMsg').textContent = 'Saved. Add a token to load your data.'; return; }
  $('#cfgMsg').textContent = 'Checking access…';
  try {
    await gh(repoPath());
    $('#cfgMsg').textContent = '✓ Connected';
    $('#settingsDlg').close();
    await loadAll();
    attachToActiveRun();
  } catch (e) {
    $('#cfgMsg').textContent = e.status === 404 ? 'Repo not found — check owner/name and that the token includes this repo.'
      : e.status === 401 ? 'Token invalid or expired.' : 'Could not connect: ' + (e.detail || e.message);
  }
}

function openTrade(sym) {
  const s = (S.dash?.stocks || []).find(x => x.symbol === sym);
  const b = (S.dash?.buys || []).find(x => x.symbol === sym);
  $('#trSym').value = sym || ''; $('#trPrice').value = b?.entry ?? s?.close ?? '';
  $('#trQty').value = b?.qty || ''; $('#trStop').value = b?.stop ?? '';
  $('#trDate').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  $('#tradeDlg').showModal();
}
async function saveTrade() {
  const sym = $('#trSym').value.trim().toUpperCase().replace(/\.NS$/, '');
  const price = parseFloat($('#trPrice').value), qty = parseInt($('#trQty').value, 10);
  const stop = $('#trStop').value ? parseFloat($('#trStop').value) : null;
  if (!/^[A-Z0-9&\-]{1,20}$/.test(sym)) return toast('Enter a valid NSE symbol');
  if (!(price > 0) || !(qty > 0)) return toast('Enter price and quantity');
  if (stop !== null && !(stop > 0 && stop < price)) return toast('Stop must be below the buy price');
  $('#tradeDlg').close();
  const inputs = { symbol: sym, price: String(price), qty: String(qty) };
  if (stop) inputs.stop = String(stop);
  if ($('#trDate').value) inputs.date = $('#trDate').value;
  await startTask('pos-add', inputs);
}
let closing = null;
function openClose(id, sym, last) {
  closing = id; $('#closeTitle').textContent = `Close ${sym}`; $('#clPrice').value = last || '';
  $('#closeDlg').showModal();
}
async function saveClose() {
  const price = parseFloat($('#clPrice').value);
  if (!(price > 0)) return toast('Enter the exit price');
  $('#closeDlg').close();
  await startTask('pos-close', { id: String(closing), price: String(price) });
}

/* ── wiring ─────────────────────────────────────────────────────────── */
function wire() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) selectTab(b.dataset.tab); });
  $('#refreshBtn').onclick = () => startTask('refresh');
  $('#settingsBtn').onclick = openSettings;
  $('#cfgSave').onclick = saveSettings;
  $('#cfgCancel').onclick = () => $('#settingsDlg').close();
  $('#cfgClear').onclick = () => { cfg.token = ''; localStorageSet(LS_KEY, JSON.stringify(cfg)); $('#cfgToken').value = ''; $('#cfgMsg').textContent = 'Token removed from this device.'; };
  $('#cfgTheme').onchange = () => { cfg.theme = $('#cfgTheme').value; applyTheme(); };
  $('#trCancel').onclick = () => $('#tradeDlg').close();
  $('#trSave').onclick = saveTrade;
  $('#clCancel').onclick = () => $('#closeDlg').close();
  $('#clSave').onclick = saveClose;
  $('#scrim').onclick = () => history.back();
  window.addEventListener('popstate', () => { if ($('#drawer').classList.contains('open')) closeDrawer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#drawer').classList.contains('open')) history.back(); });

  // delegated clicks: stock rows/cards, buttons
  document.addEventListener('click', e => {
    const bought = e.target.closest('[data-bought]');
    if (bought) { e.stopPropagation(); openTrade(bought.dataset.bought); return; }
    const cl = e.target.closest('[data-close]');
    if (cl) { e.stopPropagation(); openClose(cl.dataset.close, cl.dataset.closesym, cl.dataset.last); return; }
    if (e.target.closest('#addTradeBtn')) { openTrade(''); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { selectTab(go.dataset.goto); return; }
    const srt = e.target.closest('th[data-sort]');
    if (srt) { const k = srt.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'symbol' ? 1 : -1) }; renderStockTable(); return; }
    const cap = e.target.closest('[data-cap]');
    if (cap) { S.filt.cap = cap.dataset.cap; renderStocks(); return; }
    if (e.target.closest('#sigOnly')) { S.filt.sig = !S.filt.sig; renderStocks(); return; }
    const row = e.target.closest('[data-sym]');
    if (row && !e.target.closest('a,button') && !e.target.closest('#drawer .sig')) openStock(row.dataset.sym);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'stockQ') { S.filt.q = e.target.value; renderStockTable(); }
  });
  let rt; window.addEventListener('resize', () => {
    clearTimeout(rt); rt = setTimeout(() => {
      if (!S.dash) return;
      if (S.tab === 'market' || S.tab === 'backtest') RENDER[S.tab]();
      if (S.drawerSym) openStock(S.drawerSym);
    }, 250);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.dash && !S.tracking) { renderHeader(); attachToActiveRun(); }
  });
  setInterval(() => { if (document.visibilityState === 'visible' && !S.tracking) attachToActiveRun(); }, 180000);
  setInterval(() => { if (S.dash) renderHeader(); }, 60000);
}

async function init() {
  applyTheme();
  wire();
  const qp = new URLSearchParams(location.search);
  const saved = qp.get('tab') || localStorageGet('jarvis.tab');
  if (saved && RENDER[saved]) S.tab = saved;
  if (!cfg.token && !LOCAL) { showOnboarding(); return; }
  await loadAll(true);
  if (S.dash) selectTab(S.tab);
  if (S.dash && qp.get('sym')) openStock(qp.get('sym').toUpperCase());
  attachToActiveRun();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
