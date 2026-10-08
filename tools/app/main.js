// Physical AI 개념 지도 — app entry (bundled to assets/app.js by tools/build_app.sh)
import { select as d3select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, zoomTransform } from 'd3-zoom';
import 'd3-transition';

const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const isNarrow = () => matchMedia('(max-width: 720px)').matches;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DUR = reduce ? 0 : 360;

let V = '0', DATA = null, ALL = [], cats = [], PATHS = [];
const chunkCache = new Map(), chunkPromises = new Map();
let mode = 'av', view = 'map', selected = null;
let matches = new Set(), matchList = [], mIdx = -1, query = '';
let learned = new Set(store.get('pai-map-learned-v1', []));
let activePath = store.get('pai-map-path', null); // {id, i}

/* ---------------- data loading ---------------- */
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
function loadChunk(k) {
  if (chunkCache.has(k)) return Promise.resolve(chunkCache.get(k));
  if (!chunkPromises.has(k)) chunkPromises.set(k, getJSON(`data/d/${k}.json?v=${V}`).then(d => { chunkCache.set(k, d); updateSearchStatus(); return d; }));
  return chunkPromises.get(k);
}
async function detailOf(n) { const c = await loadChunk(n.k); return c[String(n.id)] || {}; }
const CHUNKS = ['root','basics','perception','world','planning','learning','foundation','data','hw','av1','av2','av3','safety'];
function prefetchAll() {
  // 모바일·셀룰러·데이터 절약 모드에서는 미리 받지 않음 (검색을 시작하면 그때 받음)
  const conn = navigator.connection; if (isNarrow() || (conn && (conn.saveData || conn.type === 'cellular' || /2g/.test(conn.effectiveType || '')))) return;
  const idle = window.requestIdleCallback || (f => setTimeout(f, 300));
  let i = 0; const next = () => { if (i >= CHUNKS.length) return; const k = CHUNKS[i++]; loadChunk(k).catch(() => {}).finally(() => idle(next)); };
  idle(next);
}

/* ---------------- prepare tree ---------------- */
function prepare(root) {
  let uid = 0;
  (function prep(n, depth, parent, cat, side, k) {
    n.id = uid++; n.depth = depth; n.parent = parent; n.cat = cat; n.side = side; n.k = n.k || k; n.collapsed = false;
    ALL.push(n);
    (n.c || []).forEach((ch, i) => prep(ch, depth + 1, n, depth === 0 ? i + 1 : cat, depth === 0 ? (i < 5 ? 1 : -1) : side, n.k));
  })(root, 0, null, 0, 0, 'root');
  cats = root.c;
  ALL.forEach(n => { const a = []; for (let p = n; p; p = p.parent) a.unshift(p.n); n.key = a.join(' › '); });
  ALL.forEach(n => { const lv = (n.c || []).filter(c => !c.c); if (!lv.length) return; const sw = lv.filter(c => c.s);
    if (n.depth >= 4 && lv.length === n.c.length && sw.length === lv.length) { n.swMark = true; n.swLeaves = sw.length; }
    else sw.forEach(c => { c.swMark = true; }); });
  (function mark(n) { n.avp = !!n.a; n.swp = !!n.swMark; (n.c || []).forEach(c => { mark(c); if (c.avp) n.avp = true; if (c.swp) n.swp = true; }); })(root);
}
const color = n => `var(--c${n.cat || 7})`;
const kids = n => (n.c && !n.collapsed) ? n.c : [];
function reveal(n) { for (let p = n.parent; p; p = p.parent) p.collapsed = false; }
function inPathIds() { const p = activePath && PATHS.find(x => x.id === activePath.id); return new Set(p ? p.steps.map(s => s.i) : []); }

/* ---------------- stats ---------------- */
function updateStats() {
  const total = ALL.length - 1, done = Math.min(total, ALL.filter(n => learned.has(n.key)).length);
  $('stats').innerHTML = `<b>${cats.length}</b> 영역 · 전체 <b>${total.toLocaleString()}</b>개 개념 · 최대 <b>${Math.max(...ALL.map(n => n.depth))}</b>단계 · 학습 완료 <b>${done}</b>/${total.toLocaleString()}`;
}
function saveLearned() { store.set('pai-map-learned-v1', [...learned]); updateStats(); }

/* ---------------- map: measure / layout / render ---------------- */
const fontOf = n => n.depth === 0 ? [700, 18] : n.depth === 1 ? [600, 14.5] : n.depth === 2 ? [500, 13.5]
  : n.depth === 3 ? (n.c ? [500, 13] : [400, 12.5]) : n.depth === 4 ? (n.c ? [500, 12.5] : [400, 12.5])
  : n.depth === 5 ? (n.c ? [500, 12] : [400, 12]) : n.depth === 6 ? (n.c ? [500, 11.8] : [400, 11.8]) : n.depth === 7 ? (n.c ? [500, 11.5] : [400, 11.5]) : [400, 11.2];
const styleOf = n => n.depth === 0 ? 'root' : n.depth === 1 ? 'pill' : (n.depth === 2 || (n.depth === 3 && n.c)) ? 'line' : 'dot';
const ctx = document.createElement('canvas').getContext('2d');
let FSTACK = 'sans-serif';
function measure() {
  FSTACK = getComputedStyle(document.body).fontFamily;
  ALL.forEach(n => { const [w, s] = fontOf(n); ctx.font = `${w} ${s}px ${FSTACK}`;
    const t = ctx.measureText(n.n).width, st = styleOf(n);
    n.tw = t; n.w = st === 'root' ? t + 44 : st === 'pill' ? t + 26 : st === 'line' ? t + 6 : t + 14;
    if (n.swMark && (st === 'line' || st === 'dot')) n.w += 30; });
}
function layout() {
  const vis = [], links = [], colX = {};
  [1, -1].forEach(side => {
    const sn = ALL.filter(n => n.side === side);
    const maxW = d => Math.max(0, ...sn.filter(n => n.depth === d).map(n => n.w));
    const maxWp = d => Math.max(0, ...sn.filter(n => n.depth === d && n.c).map(n => n.w));
    const x = { 1: DATA.w / 2 + 58 }; x[2] = x[1] + maxW(1) + 66; x[3] = x[2] + maxW(2) + 56;
    for (let d = 4; d <= 8; d++) x[d] = x[d - 1] + maxWp(d - 1) + (d < 6 ? 52 : 44);
    colX[side] = x;
  });
  [1, -1].forEach(side => {
    let list = cats.filter(c => c.side === side); if (side === -1) list = list.slice().reverse();
    let y = 0;
    const walk = n => { const k = kids(n);
      if (!k.length) { n.y = y; y += n.depth >= 3 ? 21 : n.depth === 2 ? 28 : 42; return; }
      const gap = n.depth <= 2 ? 8 : 4, spread = k.some(c => kids(c).length);
      k.forEach((ch, i) => { if (i && spread) y += gap; walk(ch); });
      n.y = (k[0].y + k[k.length - 1].y) / 2; };
    list.forEach((c, i) => { if (i) y += 20; walk(c); });
    const shift = y / 2 - 10; const fix = n => { n.y -= shift; kids(n).forEach(fix); }; list.forEach(fix);
  });
  DATA.y = 0; DATA.bx = -DATA.w / 2;
  const place = n => { if (n.depth > 0) { const x = colX[n.side][n.depth]; n.bx = n.side > 0 ? x : -x - n.w; }
    vis.push(n); kids(n).forEach(ch => { links.push({ s: n, t: ch }); place(ch); }); };
  place(DATA);
  return { vis, links };
}
const outer = (n, side) => n.depth === 0 ? side * n.w / 2 : (n.side > 0 ? n.bx + n.w : n.bx);
const inner = n => n.side > 0 ? n.bx : n.bx + n.w;
const linkPath = l => { const sx = outer(l.s, l.t.side), sy = l.s.y, tx = inner(l.t), ty = l.t.y, mx = (sx + tx) / 2; return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`; };
const faded = n => !query && n.depth > 0 && ((mode === 'av' && !n.avp) || (mode === 'sw' && !n.swp));

let svg, vp, zoomer, stage;
function render() {
  if (view !== 'map') { renderList(); return; }
  const { vis, links } = layout(); const t = svg.transition().duration(DUR);
  const pathIds = inPathIds();
  d3select('#links').selectAll('path.link').data(links, d => d.t.id).join(
    en => en.append('path').attr('class', 'link').attr('d', linkPath).attr('opacity', 0)
      .attr('stroke', d => color(d.t)).attr('stroke-width', d => [0, 3, 2, 1.4, 1.15, 1, .9, .8, .75][d.t.depth])
      .call(e => e.transition(t).attr('opacity', d => d.t.c ? .8 : .55)),
    up => up.call(u => u.transition(t).attr('d', linkPath).attr('opacity', d => d.t.c ? .8 : .55)),
    ex => ex.call(x => x.transition(t).attr('opacity', 0).remove())
  ).classed('dim', d => query && !matches.has(d.t.id)).classed('fade', d => faded(d.t));
  const cur = mIdx >= 0 ? matchList[mIdx] : null;
  d3select('#nodes').selectAll('g.node').data(vis, d => d.id).join(
    en => { const g = en.append('g').attr('class', d => 'node d' + d.depth + ' s-' + styleOf(d) + (d.c ? '' : ' leaf')).attr('tabindex', 0).attr('role', 'button')
        .attr('aria-label', d => d.n).style('color', d => color(d)).attr('transform', d => `translate(${d.bx},${d.y})`).attr('opacity', 0);
      g.each(function (d) { drawNode(d3select(this), d); });
      g.on('click', (ev, d) => { ev.stopPropagation(); selectNode(d); })
       .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectNode(d); if (d.c && d.depth) toggle(d); } });
      g.transition(t).attr('opacity', 1); return g; },
    up => up.call(u => u.transition(t).attr('transform', d => `translate(${d.bx},${d.y})`).attr('opacity', 1)),
    ex => ex.call(x => x.transition(t).attr('opacity', 0).remove())
  )
  .classed('sel', d => d === selected).classed('match', d => matches.has(d.id)).classed('cur', d => d === cur)
  .classed('done', d => learned.has(d.key)).classed('inpath', d => pathIds.has(d.id))
  .classed('dim', d => query && !matches.has(d.id) && d.depth > 0).classed('fade', d => faded(d))
  .each(function (d) { const tg = d3select(this).select('.tog'); if (!tg.empty()) tg.select('text').text(d.collapsed ? '+' + d.c.length : '−'); });
}
function drawNode(g, d) {
  const [fw, fs] = fontOf(d), st = styleOf(d);
  if (st === 'root') {
    g.append('rect').attr('class', 'hit').attr('x', -4).attr('y', -26).attr('width', d.w + 8).attr('height', 52);
    g.append('rect').attr('width', d.w).attr('height', 44).attr('y', -22).attr('rx', 22).style('fill', 'var(--fg)');
    g.append('text').attr('x', d.w / 2).attr('text-anchor', 'middle').attr('dominant-baseline', 'central').style('font-weight', fw).style('font-size', fs + 'px').style('fill', 'var(--bg)').text(d.n);
    return;
  }
  if (st === 'pill') {
    g.append('rect').attr('class', 'hit').attr('x', -4).attr('y', -19).attr('width', d.w + 8).attr('height', 38);
    g.append('rect').attr('width', d.w).attr('height', 30).attr('y', -15).attr('rx', 15).style('fill', `color-mix(in srgb, ${color(d)} 14%, var(--surface))`).style('stroke', color(d)).style('stroke-width', 1.5);
    g.append('text').attr('class', 'lbl').attr('x', 13).attr('dominant-baseline', 'central').style('font-weight', fw).style('font-size', fs + 'px').text(d.n);
  } else if (st === 'line') {
    g.append('rect').attr('class', 'hit').attr('x', -4).attr('y', -22).attr('width', d.w + 8).attr('height', 27);
    g.append('text').attr('class', 'lbl').attr('x', 3).attr('y', -6).style('font-weight', fw).style('font-size', fs + 'px').text(d.n);
    g.append('line').attr('x1', 0).attr('x2', d.w).attr('y1', 0).attr('y2', 0).style('stroke', color(d)).style('stroke-width', d.depth === 2 ? 2 : 1.5).style('stroke-linecap', 'round');
  } else {
    const dotX = d.side > 0 ? 4 : d.w - 4, tx = d.side > 0 ? 12 : 0;
    g.append('rect').attr('class', 'hit').attr('x', -4).attr('y', -11).attr('width', d.w + 8).attr('height', 22);
    g.append('circle').attr('cx', dotX).attr('r', d.c ? 3.2 : 2.6).style('fill', color(d));
    g.append('text').attr('class', 'lbl').attr('x', tx).attr('dominant-baseline', 'central').style('font-weight', fw).style('font-size', fs + 'px').text(d.n);
  }
  if (d.swMark && (st === 'line' || st === 'dot')) {
    const bx = (st === 'line' ? 3 : (d.side > 0 ? 12 : 0)) + d.tw + 6, by = st === 'line' ? -10.5 : 0;
    const b = g.append('g').attr('class', 'swb').attr('transform', `translate(${bx},${by})`);
    b.append('title').text(d.c ? `하위 말단 ${d.swLeaves}개가 모두 SW 관련 항목` : 'SW 관련 항목');
    b.append('rect').attr('width', 24).attr('height', 13).attr('y', -6.5).attr('rx', 3);
    b.append('text').attr('x', 12).text('SW');
  }
  if (d.c && d.c.length) {
    const cx = d.side > 0 ? d.w + 14 : -14;
    const tg = g.append('g').attr('class', 'tog').attr('transform', `translate(${cx},0)`).style('color', color(d));
    tg.append('circle').attr('r', 9).style('stroke', color(d));
    tg.append('text').style('fill', color(d)).text('−');
    tg.on('click', ev => { ev.stopPropagation(); toggle(d); });
  }
}
function toggle(d) { d.collapsed = !d.collapsed; setDepthButtons(null); render(); }

/* ---------------- list view ---------------- */
const visibleInMode = n => mode === 'none' || (mode === 'av' ? n.avp : n.swp) || n.depth === 0;
function countDone(n) { let t = 0, d = 0; (function w(m) { if (m !== n) { t++; if (learned.has(m.key)) d++; } (m.c || []).forEach(w); })(n); return [d, t]; }
function renderList() {
  const box = $('list'); const keepScroll = box.scrollTop; box.innerHTML = '';
  const pathIds = inPathIds();
  if (query) {
    const h = el('div', 'lhead', matchList.length ? `검색 결과 ${matchList.length}건 — 항목을 누르면 설명이 열립니다` : '일치하는 개념이 없습니다.'); box.append(h);
    matchList.slice(0, 300).forEach(n => box.append(listRow(n, 0, pathIds, true)));
    return;
  }
  box.append(el('div', 'lhead', mode === 'none' ? '전체 개념 · ▸ 를 눌러 하위 개념을 펼칩니다' : mode === 'av' ? '자율주행 관련 개념만 표시 중' : 'SW 관련 개념만 표시 중'));
  const walk = (n, depth) => { (n.c || []).forEach(c => { if (!visibleInMode(c)) return; box.append(listRow(c, depth, pathIds, false)); if (c.c && c.lopen) walk(c, depth + 1); }); };
  walk(DATA, 0);
  box.scrollTop = keepScroll;
}
function listRow(n, depth, pathIds, flat) {
  const r = el('div', `li d${n.depth}` + (n.c ? '' : ' leaf') + (learned.has(n.key) ? ' done' : '') + (n === selected ? ' sel' : ''));
  r.style.setProperty('--ind', (flat ? 0 : depth * 14) + 'px'); r.tabIndex = 0; r.setAttribute('role', 'treeitem');
  const car = el('button', 'car' + (n.c && !flat ? '' : ' none'), n.lopen ? '▾' : '▸'); car.type = 'button'; car.setAttribute('aria-label', n.lopen ? '접기' : '펼치기');
  car.onclick = e => { e.stopPropagation(); n.lopen = !n.lopen; renderList(); };
  const dot = el('i', 'dot'); dot.style.background = color(n);
  const nm = el('span', 'nm', n.n);
  if (flat) { const p = el('small', null, ' ' + n.key.split(' › ').slice(1, -1).join(' › ')); p.style.cssText = 'display:block;font-size:11px;color:var(--muted)'; nm.append(p); }
  r.append(car, dot, nm);
  if (n.swMark) r.append(el('i', 'swk', 'SW'));
  if (pathIds.has(n.id)) r.append(el('i', 'avk', '경로'));
  if (n.depth === 1) { const [d, t] = countDone(n); const pr = el('span', 'prog'); const i = el('i'); i.style.width = (t ? d / t * 100 : 0) + '%'; pr.append(i); pr.title = `학습 ${d}/${t}`; r.append(pr); }
  if (n.c && !flat) r.append(el('span', 'cnt', String(n.c.length)));
  if (learned.has(n.key)) r.append(el('i', 'okk', '●'));
  r.onclick = () => selectNode(n);
  r.onkeydown = e => { if (e.key === 'Enter') selectNode(n); if (e.key === 'ArrowRight' && n.c) { n.lopen = true; renderList(); } if (e.key === 'ArrowLeft' && n.c) { n.lopen = false; renderList(); } };
  return r;
}
function revealList(n) { for (let p = n.parent; p; p = p.parent) p.lopen = true; }

/* ---------------- views & modes ---------------- */
function setView(v) {
  view = v; document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('stage').hidden = v !== 'map'; $('list').hidden = v !== 'list';
  document.querySelectorAll('.maponly').forEach(e => e.style.visibility = v === 'map' ? '' : 'hidden');
  store.set('pai-map-view', v);
  if (v === 'map') { render(); setTimeout(() => fit('width'), 0); } else { if (selected) revealList(selected); renderList(); }
}
function setModeButtons(m) { document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); }
function setMode(m, opts = {}) {
  mode = m; setModeButtons(m);
  if (m === 'av') ALL.forEach(n => { if (n.depth === 0) return; n.collapsed = n.depth === 1 ? false : n.depth >= 4 ? true : !n.avp; });
  else if (m === 'sw') ALL.forEach(n => { if (n.depth === 0 || !n.c) return; n.collapsed = n.swMark ? true : !n.c.some(c => c.swp); });
  else if (opts.depth) ALL.forEach(n => { if (n.depth > 0) n.collapsed = n.depth >= opts.depth; });
  setDepthButtons(opts.depth || null); render();
  if (view === 'map' && !opts.noFit) setTimeout(() => fit('width'), 0);
}
function setDepthButtons(k) { document.querySelectorAll('[data-depth]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.depth === k))); }

/* ---------------- zoom ---------------- */
function bounds() { const { vis } = layout(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  vis.forEach(n => { x0 = Math.min(x0, n.bx - 24); x1 = Math.max(x1, n.bx + n.w + 24); y0 = Math.min(y0, n.y - 24); y1 = Math.max(y1, n.y + 24); }); return { x0, x1, y0, y1 }; }
function fit(m) {
  if (view !== 'map') return;
  const W = stage.clientWidth, H = stage.clientHeight, b = bounds(), bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  let k = m === 'width' ? Math.min(W / bw, 1) : Math.min(W / bw, H / bh, 1.1);
  k = Math.max(k, m === 'width' ? (mode !== 'none' ? 0.6 : 0.45) : 0.15);
  svg.transition().duration(DUR).call(zoomer.transform, zoomIdentity.translate(W / 2 - (b.x0 + b.x1) / 2 * k, H / 2 - (b.y0 + b.y1) / 2 * k).scale(k));
}
const panelEl = () => $('info');
const panelCover = () => panelEl().classList.contains('open') && stage.clientWidth > 720 ? panelEl().offsetWidth : 0;
function centerOn(n) {
  if (view !== 'map' || n.bx == null) return;
  const W = stage.clientWidth - panelCover(), H = stage.clientHeight, k = Math.max(zoomTransform(svg.node()).k, 0.9);
  svg.transition().duration(DUR).call(zoomer.transform, zoomIdentity.translate(W / 2 - (n.bx + n.w / 2) * k, H / 2 - n.y * k).scale(k));
}
function keepVisible(n) {
  if (view !== 'map' || n.bx == null) return;
  const t = zoomTransform(svg.node()); const right = t.applyX(n.bx + n.w + 30), left = t.applyX(n.bx - 20);
  const limit = stage.clientWidth - panelCover() - 16; if (right > limit && left > 16) svg.transition().duration(DUR).call(zoomer.translateBy, (limit - right) / t.k, 0);
}

/* ---------------- panel ---------------- */
function openPanel(n, center) { const p = panelEl(), was = p.classList.contains('open'); p.classList.remove('closing'); p.classList.add('open'); $('ptab').hidden = true;
  if (n) setTimeout(() => center ? centerOn(n) : keepVisible(n), was ? 0 : 40); }
function closePanel() { const p = panelEl(); if (!p.classList.contains('open')) return; p.classList.add('closing'); p.classList.remove('open'); $('ptab').hidden = !selected;
  setTimeout(() => p.classList.remove('closing'), 340); }

const LV = ['ROOT', 'LEVEL 1 · 영역', 'LEVEL 2 · 키워드', 'LEVEL 3 · 하위 개념', 'LEVEL 4 · 세부 개념', 'LEVEL 5 · 구성요소', 'LEVEL 6 · 세부 요소', 'LEVEL 7 · 세부 요소', 'LEVEL 8 · 세부 요건'];
const hist = []; let seq = 0;
function section(title) { const s = el('section', 'sec'); s.append(el('h3', null, title)); return s; }
function jump(n) { reveal(n); revealList(n); selectNode(n, { center: true }); }
function selectNode(d, opts = {}) {
  if (!opts.fromBack && selected && selected !== d) { hist.push(selected); if (hist.length > 100) hist.shift(); }
  $('back').disabled = !hist.length;
  selected = d; render();
  if (!opts.noOpen) openPanel(d, opts.center); else if (opts.center) centerOn(d);
  if (!opts.noHash && d.depth > 0) history.replaceState(null, '', '#n' + d.id); else if (!opts.noHash) history.replaceState(null, '', location.pathname + location.search);
  const info = $('infoBody'); info.innerHTML = ''; info.scrollTop = 0; const my = ++seq;
  // path step box
  const P = activePath && PATHS.find(x => x.id === activePath.id);
  const stepIdx = P ? P.steps.findIndex(s => s.i === d.id) : -1;
  if (stepIdx >= 0) { activePath.i = stepIdx; store.set('pai-map-path', activePath); renderPathbar();
    const sb = el('div', 'stepbox'); sb.append(el('b', null, `학습 경로 · ${P.title} · ${stepIdx + 1}/${P.steps.length}`), document.createTextNode(P.steps[stepIdx].note)); info.append(sb); }
  // nav row
  const nav = el('div', 'navrow');
  if (d.depth > 0) { const done = el('button', 'btn done', learned.has(d.key) ? '✓ 학습 완료' : '학습 완료로 표시'); done.type = 'button';
    done.setAttribute('aria-pressed', String(learned.has(d.key)));
    done.onclick = () => { if (learned.has(d.key)) learned.delete(d.key); else learned.add(d.key); saveLearned(); selectNode(d, { fromBack: true }); renderPathbar(); };
    nav.append(done); }
  if (d.c && view === 'map') { const ex = el('button', 'btn', d.collapsed ? '하위 펼치기' : '하위 접기'); ex.type = 'button'; ex.onclick = () => { toggle(d); selectNode(d, { fromBack: true }); }; nav.append(ex); }
  info.append(nav);
  // header
  const anc = []; for (let p = d.parent; p; p = p.parent) anc.unshift(p);
  if (anc.length) { const c = el('p', 'crumb'); anc.forEach((a, i) => { const b = el('button', null, a.n); b.type = 'button'; b.onclick = () => jump(a); c.append(b); if (i < anc.length - 1) c.append(el('span', null, '›')); }); info.append(c); }
  const h = el('h2'); const dot = el('i'); dot.style.background = d.depth ? color(d) : 'var(--fg)'; h.append(dot, el('span', null, d.n)); info.append(h);
  const meta = el('div', 'meta'); meta.append(el('em', 'lvl', LV[d.depth] || 'LEVEL ' + d.depth));
  if (d.t) meta.append(el('em', 'lvl tool', '도구 · 프레임워크'));
  if (d.swMark) meta.append(el('em', 'lvl', d.c ? `SW 표식 · 하위 말단 ${d.swLeaves}개 모두 SW` : 'SW 표식 · SW 관련 항목'));
  else if (!d.c && d.s) meta.append(el('em', 'lvl', 'SW 관련 항목 (부모에 표식)'));
  if (d.a || (d.avp && d.depth > 0)) meta.append(el('em', 'lvl av', d.a ? '자율주행 관점' : '자율주행 하위 개념 포함'));
  if (learned.has(d.key)) meta.append(el('em', 'lvl ok', '학습 완료'));
  info.append(meta);
  const holder = el('div'); holder.append(el('div', 'skel'), el('div', 'skel'), el('div', 'skel')); info.append(holder);
  detailOf(d).then(det => { if (my !== seq) return; holder.replaceWith(...detailNodes(d, det)); })
    .catch(() => { if (my !== seq) return; holder.replaceWith(el('p', 'empty', '설명을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 눌러 주세요.')); });
}
function detailNodes(d, det) {
  const out = [];
  const addText = (t, v) => { if (!v) return; const s = section(t); s.append(el('p', 'desc', v)); out.push(s); };
  addText('정의', det.d);
  if (d.g) { const s = section('다이어그램'); const box = el('div', 'diagram'); const pic = document.createElement('picture');
    const src = document.createElement('source'); src.media = '(prefers-color-scheme: dark)'; src.srcset = `diagrams/dark/n${d.id}.svg?v=${V}`;
    const img = document.createElement('img'); img.src = `diagrams/light/n${d.id}.svg?v=${V}`; img.alt = d.n + ' 다이어그램'; img.loading = 'lazy'; img.decoding = 'async';
    const forced = document.documentElement.getAttribute('data-theme'); if (forced) img.src = `diagrams/${forced}/n${d.id}.svg?v=${V}`; else pic.append(src);
    pic.append(img); box.append(pic);
    // 넓은 다이어그램은 패널 폭에 억지로 줄이지 않고 72% 배율로 두고 가로 스크롤
    img.onload = () => { const bw = box.clientWidth - 24, nw = img.naturalWidth; if (!isNarrow() && nw > bw && bw > 0) { img.style.maxWidth = 'none'; img.style.width = Math.round(Math.max(bw, nw * 0.72)) + 'px'; } };
    const zb = el('button', 'zbtn', '⤢ 크게 보기'); zb.type = 'button'; s.querySelector('h3').append(zb);
    const open = () => openDiagram(d, pic); zb.onclick = open; img.onclick = open; img.title = '눌러서 크게 보기';
    s.append(box); out.push(s); }
  addText('SW 구현 포인트', det.sw);
  if (det.feat && det.feat.length) { const s = section('주요 구성 · 기능'); const ul = el('ul', 'feat'); det.feat.forEach(x => ul.append(el('li', null, x))); s.append(ul); out.push(s); }
  if (det.tech) { const s = section('대표 기술 · 도구 · 표준'); const tg = el('div', 'tags'); det.tech.split(/,(?![^()]*\))/).map(x => x.trim()).filter(Boolean).forEach(x => tg.append(el('span', null, x))); s.append(tg); out.push(s); }
  addText('실무 이슈 · 트레이드오프', det.issue);
  if (det.rel && det.rel.length) { const s = section('관련 노드'); const box = el('div', 'chips rel');
    det.rel.forEach(id => { const n = ALL[id]; if (!n) return; const b = el('button', null, (n.parent ? n.parent.n + ' › ' : '') + n.n); b.type = 'button'; b.title = n.key; b.onclick = () => jump(n); box.append(b); });
    s.append(box); out.push(s); }
  if (d.c && d.c.length) { const s = section(`하위 노드 (${d.c.length})`); const box = el('div', 'chips');
    d.c.forEach(ch => { const b = el('button', null, ch.n); b.type = 'button'; if (ch.swMark) b.append(el('i', 'swk', 'SW')); if (learned.has(ch.key)) { b.classList.add('isdone'); b.append(el('i', 'okk', '●')); } b.onclick = () => jump(ch); box.append(b); });
    s.append(box); out.push(s); }
  if (det.src && det.src.length) { const s = section('참고 자료'); const ul = el('ul', 'src');
    det.src.forEach(x => { const li = el('li'); const a = el('a', null, x.t || x.u); a.href = x.u; a.target = '_blank'; a.rel = 'noopener'; li.append(a); ul.append(li); }); s.append(ul); out.push(s); }
  if (det.url) { const s = section('공식 사이트 · 저장소'); const a = el('a', 'ext', det.url.replace(/^https?:\/\//, '').replace(/\/$/, '')); a.href = det.url; a.target = '_blank'; a.rel = 'noopener'; s.append(a); out.push(s); }
  out.push(nextRow(d));
  out.push(el('p', 'anchor', `이 개념 링크: ${location.origin}${location.pathname}#n${d.id}`));
  return out;
}
function openDiagram(d, pic) {
  const m = $('dgModal'); $('dgTitle').textContent = d.n + ' — 다이어그램';
  const body = $('dgBody'); body.innerHTML = ''; const p = pic.cloneNode(true); const im = p.querySelector('img');
  im.removeAttribute('loading'); im.removeAttribute('style'); im.onclick = () => body.classList.toggle('fit'); im.title = '눌러서 화면 맞춤 / 원본 크기 전환';
  body.classList.toggle('fit', innerWidth >= 900); body.append(p);
  m.hidden = false; m.querySelector('[data-close]').focus();
}
function nextRow(d) {
  const row = el('div', 'nextrow');
  const P = activePath && PATHS.find(x => x.id === activePath.id);
  const si = P ? P.steps.findIndex(s => s.i === d.id) : -1;
  if (si >= 0) {
    row.append(el('span', 'lab', '학습 경로 진행'));
    if (si > 0) { const b = el('button', 'btn', '← 이전 단계'); b.type = 'button'; b.onclick = () => goStep(si - 1); row.append(b); }
    const nx = el('button', 'btn primary', si < P.steps.length - 1 ? '완료하고 다음 단계 →' : '완료하고 경로 마치기'); nx.type = 'button';
    nx.onclick = () => { learned.add(d.key); saveLearned(); if (si < P.steps.length - 1) goStep(si + 1); else finishPath(P); };
    row.append(nx); return row;
  }
  // free exploration suggestion: first unlearned child, else next sibling, else parent's next sibling
  let sug = (d.c || []).find(c => !learned.has(c.key));
  if (!sug && d.parent) { const sib = d.parent.c; sug = sib[sib.indexOf(d) + 1]; }
  if (!sug && d.parent && d.parent.parent) { const sib = d.parent.parent.c; sug = sib[sib.indexOf(d.parent) + 1]; }
  row.append(el('span', 'lab', '다음으로 볼 개념'));
  if (sug) { const b = el('button', 'btn primary', (d.depth > 0 && !learned.has(d.key) ? '완료하고 ' : '') + sug.n + ' →'); b.type = 'button';
    b.onclick = () => { if (d.depth > 0) { learned.add(d.key); saveLearned(); } jump(sug); }; row.append(b); }
  const lp = el('button', 'btn', '학습 경로 보기'); lp.type = 'button'; lp.onclick = openLearn; row.append(lp);
  return row;
}

/* ---------------- learning paths ---------------- */
function pathProgress(P) { const done = P.steps.filter(s => learned.has(ALL[s.i].key)).length; return [done, P.steps.length]; }
function startPath(id, i) {
  const P = PATHS.find(x => x.id === id); if (!P) return;
  if (i == null) { i = P.steps.findIndex(s => !learned.has(ALL[s.i].key)); if (i < 0) i = 0; }
  activePath = { id, i }; store.set('pai-map-path', activePath); closeModals(); renderPathbar(); goStep(i);
}
function goStep(i) {
  const P = activePath && PATHS.find(x => x.id === activePath.id); if (!P) return;
  i = Math.max(0, Math.min(P.steps.length - 1, i)); activePath.i = i; store.set('pai-map-path', activePath);
  const n = ALL[P.steps[i].i];
  if (view === 'map' && mode !== 'none' && faded(n)) setMode('none', { noFit: true, depth: 3 });
  renderPathbar(); jump(n);
}
function finishPath(P) { activePath = null; store.set('pai-map-path', null); renderPathbar(); render(); openLearn(`'${P.title}' 경로를 마쳤습니다. 다음 경로를 골라 보세요.`); }
function renderPathbar() {
  const bar = $('pathbar'); const P = activePath && PATHS.find(x => x.id === activePath.id);
  if (!P) { bar.hidden = true; bar.innerHTML = ''; return; }
  const [d, t] = pathProgress(P); const i = activePath.i || 0;
  bar.innerHTML = ''; bar.hidden = false;
  bar.append(el('span', 'pt', P.title), el('span', 'ps', `${i + 1}/${t} 단계 · 완료 ${d}`));
  const pb = el('span', 'pbar'); const fill = el('i'); fill.style.width = (d / t * 100) + '%'; pb.append(fill); bar.append(pb);
  bar.append(el('span', 'pn', '지금: ' + ALL[P.steps[i].i].n + ' — ' + P.steps[i].note));
  const mk = (txt, fn, cls = 'btn') => { const b = el('button', cls, txt); b.type = 'button'; b.onclick = fn; bar.append(b); };
  mk('←', () => goStep(i - 1)); mk('현재 단계 열기', () => goStep(i), 'btn primary'); mk('→', () => goStep(i + 1)); mk('경로 목록', openLearn);
  mk('경로 종료', () => { activePath = null; store.set('pai-map-path', null); renderPathbar(); render(); });
}
function openLearn(msg) {
  const body = $('lmBody'); body.innerHTML = '';
  if (typeof msg === 'string') body.append(el('p', 'stepbox', msg));
  body.append(el('p', 'empty', '역할에 맞는 경로를 고르면 10~13개 개념을 순서대로 안내합니다. 각 단계에서 설명을 읽고 "완료하고 다음 단계"를 누르면 진도가 기록됩니다(이 브라우저에 저장).'));
  body.append(el('h3', null, '학습 경로'));
  const cards = el('div', 'cards');
  PATHS.forEach(P => {
    const [d, t] = pathProgress(P); const c = el('div', 'card' + (activePath && activePath.id === P.id ? ' active' : ''));
    c.append(el('span', 'who', P.who), el('h4', null, P.title), el('p', null, P.goal));
    const bar = el('div', 'bar'); const f = el('i'); f.style.width = (d / t * 100) + '%'; bar.append(f); c.append(bar);
    const det = document.createElement('details'); det.append(el('summary', null, `단계 ${t}개 보기`)); const ol = el('ol');
    P.steps.forEach((s, i) => { const li = el('li', learned.has(ALL[s.i].key) ? 'ok' : ''); const b = el('button', null, ALL[s.i].n + (learned.has(ALL[s.i].key) ? ' ✓' : '')); b.type = 'button'; b.onclick = () => startPath(P.id, i); li.append(b); ol.append(li); });
    det.append(ol); c.append(det);
    const foot = el('div', 'foot'); foot.append(el('small', null, `완료 ${d}/${t} · 약 ${t * 5}분`));
    const go = el('button', 'btn primary', d === 0 ? '시작' : d === t ? '다시 보기' : '이어서 학습'); go.type = 'button'; go.onclick = () => startPath(P.id, d === t ? 0 : null); foot.append(go); c.append(foot);
    cards.append(c);
  });
  body.append(cards);
  body.append(el('h3', null, '영역별 학습 현황'));
  const cp = el('div', 'catprog');
  cats.forEach(cn => { const [d, t] = countDone(cn); const box = el('div'); const s = el('small', null, `${d}/${t}`); box.append(s, document.createTextNode(cn.n));
    const bar = el('div', 'bar'); const f = el('i'); f.style.width = (t ? d / t * 100 : 0) + '%'; bar.append(f); box.append(bar); cp.append(box); });
  body.append(cp);
  $('learnModal').hidden = false;
}
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.hidden = true); }

/* ---------------- search ---------------- */
function nodeText(n) { const c = chunkCache.get(n.k); const d = c && c[String(n.id)]; if (!d) return ''; return [d.d, d.sw, d.tech, d.issue, ...(d.feat || [])].join(' ').toLowerCase(); }
function updateSearchStatus() { if (query) runSearch(true); }
function runSearch(keepIdx) {
  const q = $('q'); query = q.value.trim().toLowerCase();
  const prevCur = mIdx >= 0 ? matchList[mIdx] : null;
  matches = new Set(); matchList = []; mIdx = -1;
  if (query) {
    const byName = [], byText = [];
    ALL.forEach(n => { if (n.depth === 0) return; if (n.n.toLowerCase().includes(query)) byName.push(n); else if (nodeText(n).includes(query)) byText.push(n); });
    matchList = byName.concat(byText); matchList.forEach(n => { matches.add(n.id); reveal(n); });
    if (keepIdx && prevCur) mIdx = matchList.indexOf(prevCur);
    setDepthButtons(null);
  }
  const loaded = chunkCache.size, total = CHUNKS.length;
  $('qcount').textContent = query ? (matchList.length ? `${mIdx + 1}/${matchList.length}` : '0건') : '';
  ['qprev', 'qnext'].forEach(id => $(id).hidden = !matchList.length); $('qclear').hidden = !q.value;
  renderResults(loaded < total); render();
  if (query && loaded < total) CHUNKS.forEach(k => loadChunk(k).catch(() => {}));
}
function renderResults(partial) {
  const res = $('results'); res.innerHTML = '';
  if (!query || view === 'list') { res.hidden = true; return; }
  if (partial) res.append(el('p', null, '설명 본문 검색을 준비 중입니다. 지금은 이름 위주로 보여 줍니다.'));
  if (!matchList.length) { res.append(el('p', null, '일치하는 개념이 없습니다. 다른 키워드나 약어를 입력해 보세요.')); res.hidden = false; return; }
  matchList.slice(0, 80).forEach((n, i) => { const b = el('button'); b.type = 'button'; if (i === mIdx) b.classList.add('cur');
    b.append(el('b', null, n.n), el('span', null, n.key.split(' › ').slice(1, -1).join(' › ')));
    b.onmousedown = e => e.preventDefault(); b.onclick = () => goMatch(i); res.append(b); });
  if (matchList.length > 80) res.append(el('p', null, `상위 80개만 표시합니다. Enter로 전체 ${matchList.length}건을 차례로 이동할 수 있습니다.`));
  res.hidden = document.activeElement !== $('q');
}
function goMatch(i) {
  if (!matchList.length) return;
  mIdx = (i + matchList.length) % matchList.length; const n = matchList[mIdx];
  $('qcount').textContent = `${mIdx + 1}/${matchList.length}`; reveal(n); selectNode(n); centerOn(n);
  const res = $('results'); const cur = res.querySelector('.cur'); if (cur) cur.classList.remove('cur');
  const btns = res.querySelectorAll('button'); const b = btns[mIdx]; if (b) { b.classList.add('cur'); b.scrollIntoView({ block: 'nearest' }); }
}
function clearSearch() { $('q').value = ''; runSearch(); $('results').hidden = true; }

/* ---------------- glossary ---------------- */
let GLOSS = null;
async function showGloss() {
  $('glossModal').hidden = false;
  if (!GLOSS) { $('glList').innerHTML = '<p class="empty">불러오는 중…</p>'; try { GLOSS = await getJSON(`data/glossary.json?v=${V}`); } catch (e) { $('glList').innerHTML = '<p class="empty">약어 사전을 불러오지 못했습니다.</p>'; return; } }
  const f = $('glq').value.trim().toLowerCase(); const list = GLOSS.filter(g => !f || g.a.toLowerCase().includes(f) || g.e.toLowerCase().includes(f));
  const box = $('glList'); box.innerHTML = '';
  list.forEach(g => { const b = el('button'); b.type = 'button'; const right = el('span', null, g.e); const n0 = ALL[g.i[0]];
    right.append(el('small', null, '예: ' + n0.n + (g.i.length > 1 ? ` 외 ${g.i.length - 1}곳` : ''))); b.append(el('b', null, g.a), right);
    b.onclick = () => { closeModals(); jump(n0); }; box.append(b); });
  if (!list.length) box.append(el('p', 'empty', '일치하는 약어가 없습니다.'));
  $('glTitle').textContent = `약어 사전 (${GLOSS.length})`;
}

/* ---------------- wiring ---------------- */
function wire() {
  stage = $('stage'); svg = d3select('#svg'); vp = d3select('#vp');
  zoomer = d3zoom().scaleExtent([0.15, 2.5]).filter(ev => ev.type === 'wheel' ? ev.ctrlKey : (!ev.button)).on('zoom', ev => vp.attr('transform', ev.transform));
  svg.call(zoomer).on('dblclick.zoom', null);
  svg.on('wheel.pan', ev => { if (ev.ctrlKey) return; ev.preventDefault(); const k = zoomTransform(svg.node()).k; zoomer.translateBy(svg, -ev.deltaX / k, -ev.deltaY / k); }, { passive: false });
  $('zin').onclick = () => svg.transition().duration(DUR).call(zoomer.scaleBy, 1.25);
  $('zout').onclick = () => svg.transition().duration(DUR).call(zoomer.scaleBy, 0.8);
  $('fit').onclick = () => fit('all');
  $('back').onclick = () => { const n = hist.pop(); if (n) { reveal(n); revealList(n); selectNode(n, { fromBack: true }); centerOn(n); } $('back').disabled = !hist.length; };
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => b.dataset.mode === 'none' ? setMode('none', { depth: 3 }) : setMode(b.dataset.mode));
  document.querySelectorAll('[data-depth]').forEach(b => b.onclick = () => { mode = 'none'; setModeButtons('none'); setMode('none', { depth: +b.dataset.depth }); });
  const q = $('q');
  let tmr; q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => runSearch(), 120); });
  q.addEventListener('focus', () => { if (query && view === 'map') $('results').hidden = false; });
  q.addEventListener('blur', () => setTimeout(() => { $('results').hidden = true; }, 150));
  q.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(tmr); if (q.value.trim().toLowerCase() !== query) runSearch(); goMatch(ev.shiftKey ? mIdx - 1 : mIdx + 1); } else if (ev.key === 'Escape') clearSearch(); });
  ['qprev', 'qnext', 'qclear'].forEach(id => $(id).onmousedown = e => e.preventDefault());
  $('qnext').onclick = () => goMatch(mIdx + 1); $('qprev').onclick = () => goMatch(mIdx - 1); $('qclear').onclick = () => { clearSearch(); q.focus(); };
  document.addEventListener('keydown', ev => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (ev.key === '/' && !typing) { ev.preventDefault(); q.focus(); }
    else if (ev.key === 'Escape' && !typing) { const open = [...document.querySelectorAll('.modal')].find(m => !m.hidden); if (open) closeModals(); else closePanel(); }
  });
  $('pclose').onclick = closePanel; $('ptab').onclick = () => openPanel(selected);
  $('gloss').onclick = showGloss; $('glq').addEventListener('input', showGloss);
  $('learnBtn').onclick = () => openLearn(); $('help').onclick = () => { $('introModal').hidden = false; };
  $('startIntro').onclick = () => { store.set('pai-map-onboarded', 1); startPath('intro'); };
  $('choosePath').onclick = () => { store.set('pai-map-onboarded', 1); closeModals(); openLearn(); };
  document.querySelectorAll('.modal').forEach(m => { m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) { if (m.id === 'introModal') store.set('pai-map-onboarded', 1); m.hidden = true; } }); });
  // panel resize
  const rz = $('resizer'), main = $('main');
  const w0 = store.get('pai-map-panel', 0); if (w0 >= 340 && w0 <= 1000) document.documentElement.style.setProperty('--panel', w0 + 'px');
  rz.addEventListener('pointerdown', e => { rz.setPointerCapture(e.pointerId); rz.classList.add('drag');
    const move = ev => { const r = main.getBoundingClientRect(); const w = Math.min(Math.max(r.right - ev.clientX, 340), Math.min(1000, r.width - 120)); document.documentElement.style.setProperty('--panel', w + 'px'); };
    const up = () => { rz.classList.remove('drag'); rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); store.set('pai-map-panel', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel'))); };
    rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up); });
  window.addEventListener('hashchange', () => { const m = /^#n(\d+)$/.exec(location.hash); if (m && ALL[+m[1]] && ALL[+m[1]] !== selected) jump(ALL[+m[1]]); });
}

/* ---------------- boot ---------------- */
async function boot() {
  try {
    try { V = (await (await fetch('data/version.json', { cache: 'no-cache' })).json()).v; } catch (e) { V = String(Date.now()); }
    const [skel, paths] = await Promise.all([getJSON(`data/skeleton.json?v=${V}`), getJSON(`data/paths.json?v=${V}`)]);
    DATA = skel; PATHS = paths; prepare(DATA);
  } catch (e) { $('loading').textContent = '데이터를 불러오지 못했습니다. 새로고침해 주세요.'; return; }
  wire();
  measure(); updateStats();
  const savedView = store.get('pai-map-view', null);
  view = savedView || (isNarrow() ? 'list' : 'map');
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('stage').hidden = view !== 'map'; $('list').hidden = view !== 'list';
  setMode('av', { noFit: view !== 'map' });
  if (view === 'list') renderList();
  $('loading').hidden = true;
  renderPathbar();
  const m = /^#n(\d+)$/.exec(location.hash || ''); const target = m ? ALL[+m[1]] : null;
  if (target) { jump(target); } else { selected = DATA; $('ptab').hidden = false; }
  if (!store.get('pai-map-onboarded', 0) && !target) $('introModal').hidden = false;
  // re-measure once webfonts arrive (first paint does not wait for them)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); if (view === 'map') { d3select('#nodes').selectAll('g.node').remove(); d3select('#links').selectAll('path.link').remove(); render(); } });
  prefetchAll();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
