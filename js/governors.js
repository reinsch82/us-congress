/* global d3 */
import { toDay, fromDay, STATEHOOD, STATE_NAMES } from './model.js';
import { partyInfo } from './parties.js';
import { $, today, fmtDate, fmtShort, fmtYear, esc, colorOf, swatch, eventIndexAtOrBefore, checkBuild } from './common.js';

const SNAPSHOT_URL = 'data/governors.json';
const NONE = 'No governor recorded';
const commonsThumb = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=120`;
const personUrl = (id) => (id.startsWith('Q') ? `https://www.wikidata.org/wiki/${id}` : null);

// Tile-grid map: [state, column, row].
const TILES = [
  ['AK', 0, 0], ['ME', 10, 0],
  ['WI', 5, 1], ['VT', 9, 1], ['NH', 10, 1],
  ['WA', 0, 2], ['ID', 1, 2], ['MT', 2, 2], ['ND', 3, 2], ['MN', 4, 2], ['IL', 5, 2], ['MI', 6, 2], ['NY', 8, 2], ['MA', 9, 2],
  ['OR', 0, 3], ['NV', 1, 3], ['WY', 2, 3], ['SD', 3, 3], ['IA', 4, 3], ['IN', 5, 3], ['OH', 6, 3], ['PA', 7, 3], ['NJ', 8, 3], ['CT', 9, 3], ['RI', 10, 3],
  ['CA', 0, 4], ['UT', 1, 4], ['CO', 2, 4], ['NE', 3, 4], ['MO', 4, 4], ['KY', 5, 4], ['WV', 6, 4], ['VA', 7, 4], ['MD', 8, 4], ['DE', 9, 4],
  ['AZ', 1, 5], ['NM', 2, 5], ['KS', 3, 5], ['AR', 4, 5], ['TN', 5, 5], ['NC', 6, 5], ['SC', 7, 5],
  ['OK', 3, 6], ['LA', 4, 6], ['MS', 5, 6], ['AL', 6, 6], ['GA', 7, 6],
  ['HI', 0, 7], ['TX', 3, 7], ['FL', 8, 7],
];
const TILE = 60, GAP = 4;

const statusEl = $('#status');
let data, firstDay, lastDay, events;
const terms = {};
const activeFrom = {};
const state = { day: today, playing: null };

// ---------------------------------------------------------------- model

function buildModel() {
  for (const [st, list] of Object.entries(data.states)) {
    terms[st] = list.map((t) => ({
      ...t,
      s: toDay(t.start),
      e: t.end ? toDay(t.end) : Infinity,
      name: data.people[t.id]?.name || t.id,
      party: t.party || 'Unknown',
    }));
    // A state appears on the map from admission, or from its first governor if earlier
    // (the original states had governors from 1776).
    activeFrom[st] = Math.min(STATEHOOD[st], terms[st][0]?.s ?? Infinity);
  }
  firstDay = Math.min(...Object.values(activeFrom));
  lastDay = today;

  const days = new Set();
  for (const [st, list] of Object.entries(terms)) {
    days.add(activeFrom[st]);
    for (const t of list) { days.add(t.s); if (t.e !== Infinity) days.add(t.e); }
  }
  events = [];
  for (const day of [...days].filter((d) => d <= lastDay).sort((a, b) => a - b)) {
    const changes = [];
    for (const st of Object.keys(terms)) {
      const before = governorOn(st, day - 1), after = governorOn(st, day);
      if (before === after) continue;
      if (before && after && before.id === after.id && before.party === after.party) continue;
      changes.push({ st, before, after, admitted: day === activeFrom[st] });
    }
    if (changes.length) events.push({ day, changes });
  }
}

function governorOn(st, day) {
  if (day < activeFrom[st]) return null;
  const list = terms[st];
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s <= day) lo = mid + 1; else hi = mid - 1;
  }
  const t = list[hi];
  return t && day < t.e ? t : null;
}

const isState = (st, day) => day >= activeFrom[st];
const partyKey = (t) => (t ? t.party : NONE);
const partyColor = (p) => (p === NONE ? 'var(--surface)' : colorOf(p));

function snapshot(day) {
  return TILES.map(([st, col, row]) => ({ st, col, row, active: isState(st, day), gov: governorOn(st, day) }));
}

// ---------------------------------------------------------------- tooltips and history

const tip = $('#seat-tip');

// Where a term's start date comes from, when it isn't Wikidata or the NGA data.
function sourceNote(t) {
  if (t.observed === 'first-seen') return 'took office on or before this date (first seen in Open States)';
  if (t.observed === 'start-date') return 'dates from Open States';
  if (t.startPrecision === 'year') return 'year only';
  return '';
}

function photoOf(id) {
  const p = data.people[id];
  if (p?.image) return commonsThumb(p.image);
  return p?.imageUrl || null;
}

function dateRange(t) {
  const start = t.startPrecision === 'year' ? fmtYear(t.s) : fmtShort(t.s);
  // Governors-elect are in the data with their inauguration date.
  if (t.s > today) return `takes office ${start}`;
  if (t.e === Infinity) return `${start} – today`;
  const end = t.endPrecision === 'year' ? fmtYear(t.e) : fmtShort(t.e);
  return t.e > today ? `${start} – ${end} (end of term)` : `${start} – ${end}`;
}

function describe(st, day) {
  const name = STATE_NAMES[st];
  if (!isState(st, day)) return `<div class="name">${esc(name)}</div><div class="muted">Not yet a state</div>`;
  const t = governorOn(st, day);
  const hint = '<div class="hint">Click for all governors</div>';
  if (!t) return `<div class="name">${esc(name)}</div><div class="muted">${NONE} on this date</div>${hint}`;
  const image = photoOf(t.id);
  return `${image ? `<img alt="" src="${esc(image)}" onerror="this.remove()">` : ''}
    <div class="name">${esc(t.name)}</div>
    <div class="line">${swatch(t.party)} ${esc(t.party)}</div>
    <div>Governor of ${esc(name)}${t.acting ? ' (acting)' : ''}</div>
    <div class="muted">${dateRange(t)}${sourceNote(t) ? `, ${sourceNote(t)}` : ''}</div>${hint}`;
}

function showTip(evt, st) {
  tip.innerHTML = describe(st, state.day);
  tip.hidden = false;
  const rect = tip.getBoundingClientRect();
  let x = evt.clientX + 14, y = evt.clientY + 14;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - 14;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - 14;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { tip.hidden = true; };

const historyDialog = $('#seat-history');

function openHistory(st) {
  hideTip();
  const list = terms[st].slice().reverse();
  const people = new Set(list.map((t) => t.id));
  $('h2', historyDialog).textContent = `Governors of ${STATE_NAMES[st]}`;
  $('[data-role="summary"]', historyDialog).textContent =
    `${people.size} governors since ${fmtYear(list[list.length - 1]?.s ?? activeFrom[st])}.`;
  $('ol', historyDialog).innerHTML = list.map((t) => {
    const current = t.s <= state.day && state.day < t.e;
    const url = personUrl(t.id);
    return `<li${current ? ' class="current" aria-current="true"' : ''}>
      <div class="who">${url ? `<a href="${url}" target="_blank" rel="noopener">${esc(t.name)}</a>` : esc(t.name)}</div>
      <div class="party">${swatch(t.party)} ${esc(t.party)}</div>
      <div class="term"><button type="button" class="link-button" data-day="${t.s}">${dateRange(t)}</button>
        <span class="muted">${[t.acting ? 'acting' : '', sourceNote(t)].filter(Boolean).join(', ')}</span></div>
    </li>`;
  }).join('');
  if (!historyDialog.open) historyDialog.showModal();
  ($('li.current', historyDialog) || $('li', historyDialog))?.scrollIntoView({ block: 'center' });
}

function setupHistory() {
  $('[data-role="close"]', historyDialog).addEventListener('click', () => historyDialog.close());
  historyDialog.addEventListener('click', (evt) => {
    if (evt.target === historyDialog) { historyDialog.close(); return; }
    const btn = evt.target.closest('button[data-day]');
    if (!btn) return;
    stopPlaying();
    setDay(Number(btn.dataset.day) + 1);
    historyDialog.close();
  });
  document.addEventListener('click', (evt) => {
    const el = evt.target.closest('[data-history]');
    if (el && !evt.target.closest('a')) openHistory(el.dataset.history);
  });
}

// ---------------------------------------------------------------- rendering

// Dark or light text, whichever reads better on the tile's fill.
function inkOn(hex) {
  if (!hex || !hex.startsWith('#')) return 'var(--ink)';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#17202c' : '#ffffff';
}

const surname = (name) => name.replace(/,? (Jr\.|Sr\.|II|III|IV)$/, '').split(' ').pop();

function renderMap(tiles, changed, animate) {
  const svg = d3.select('[data-role="map"]');
  const width = 11 * TILE + 10 * GAP, height = 8 * TILE + 7 * GAP;
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  const t = svg.transition().duration(animate ? 400 : 0);

  const g = svg.selectAll('g.tile').data(tiles, (d) => d.st).join((enter) => {
    const tile = enter.append('g').attr('class', 'tile')
      .attr('transform', (d) => `translate(${d.col * (TILE + GAP)},${d.row * (TILE + GAP)})`)
      .attr('data-history', (d) => d.st)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .on('pointerenter pointermove', (evt, d) => showTip(evt, d.st))
      .on('pointerleave', hideTip)
      .on('keydown', (evt, d) => { if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); openHistory(d.st); } });
    tile.append('rect').attr('width', TILE).attr('height', TILE).attr('rx', 3);
    tile.append('text').attr('class', 'abbr').attr('x', 6).attr('y', 18);
    tile.append('text').attr('class', 'gov').attr('x', 6).attr('y', TILE - 8);
    return tile;
  });

  g.classed('inactive', (d) => !d.active).classed('none', (d) => d.active && !d.gov).classed('changed', (d) => changed.has(d.st))
    .attr('aria-label', (d) => `${STATE_NAMES[d.st]}: ${!d.active ? 'not yet a state' : d.gov ? `${d.gov.name}, ${d.gov.party}` : NONE}`);
  g.select('rect').transition(t)
    .attr('fill', (d) => (d.active && d.gov ? colorOf(d.gov.party) : 'var(--surface)'));
  g.select('text.abbr').text((d) => d.st)
    .attr('fill', (d) => (d.active && d.gov ? inkOn(partyInfo(d.gov.party).color) : 'var(--muted)'));
  g.select('text.gov').text((d) => (d.active && d.gov ? surname(d.gov.name) : ''))
    .attr('fill', (d) => (d.active && d.gov ? inkOn(partyInfo(d.gov.party).color) : 'var(--muted)'))
    .attr('textLength', function (d) { return d.active && d.gov && surname(d.gov.name).length > 9 ? TILE - 12 : null; })
    .attr('lengthAdjust', 'spacingAndGlyphs');
}

function renderTally(tiles) {
  const active = tiles.filter((d) => d.active);
  const counts = d3.rollups(active, (v) => v.length, (d) => partyKey(d.gov)).sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1] - a[1]);
  $('[data-role="tally"]').innerHTML = counts.map(([p, n]) =>
    `<span class="chip">${p === NONE ? '<span class="swatch vacant"></span>' : swatch(p)}${esc(p)} <b>${n}</b></span>`).join('')
    + (active.length < 50 ? `<span class="chip"><span class="swatch inactive"></span>Not yet a state <b>${50 - active.length}</b></span>` : '');
  const top = counts.find(([p]) => p !== NONE);
  $('[data-role="majority"]').innerHTML = top
    ? `<strong>${esc(top[0])}</strong> ${top[1]} of ${active.length} governorships`
    : '';
}

function changeLine(c) {
  const name = `<span class="seat-name">${esc(STATE_NAMES[c.st])}</span>`;
  const who = (t) => `${esc(t.name)} (${esc(t.party)})`;
  let text;
  if (c.admitted && c.after) text = `Became a state; ${who(c.after)} governor`;
  else if (c.admitted) text = 'Became a state';
  else if (c.before && c.after && c.before.id === c.after.id) text = `${esc(c.after.name)} switched from ${esc(c.before.party)} to ${esc(c.after.party)}`;
  else if (c.before && c.after) text = `${who(c.after)} succeeded ${who(c.before)}${c.after.acting ? ' as acting governor' : ''}`;
  else if (c.after) text = `${who(c.after)} took office${c.after.acting ? ' as acting governor' : ''}`;
  else text = `${who(c.before)} left office; ${NONE.toLowerCase()} after this`;
  return `<li data-history="${c.st}">${swatch(c.after ? c.after.party : 'Vacant')}<span>${text} ${name}</span></li>`;
}

function renderChanges(day) {
  const el = $('[data-role="changes"]');
  const i = eventIndexAtOrBefore(events, day);
  if (i < 0) { el.innerHTML = ''; return new Set(); }
  const ev = events[i];
  const shown = 12;
  const items = ev.changes.map(changeLine);
  el.innerHTML = `<h3>${ev.day === day ? 'Changes on this day' : `Most recent change: ${fmtDate(ev.day)}`}</h3>
    ${ev.changes.length > 1 ? '<p class="net">Changed states are outlined.</p>' : ''}
    <ul>${items.slice(0, shown).join('')}</ul>
    ${items.length > shown ? `<details><summary>Show ${items.length - shown} more</summary><ul>${items.slice(shown).join('')}</ul></details>` : ''}`;
  return new Set(ev.changes.map((c) => c.st));
}

function renderRoster(tiles) {
  const details = $('[data-role="roster"]');
  if (!details.open) return;
  const rows = tiles.filter((d) => d.active).sort((a, b) => STATE_NAMES[a.st].localeCompare(STATE_NAMES[b.st]));
  $('div', details).innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>State</th><th>Governor</th><th>Party</th><th>In office</th></tr></thead>
    <tbody>${rows.map(({ st, gov }) => `<tr><td><button type="button" class="link-button" data-history="${st}">${esc(STATE_NAMES[st])}</button></td>
      <td>${gov ? esc(gov.name) : `<span class="muted">${NONE}</span>`}</td>
      <td>${gov ? `${swatch(gov.party)} ${esc(gov.party)}` : ''}</td>
      <td>${gov ? dateRange(gov) : ''}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------- timeline

let series, x;

function buildSeries() {
  const days = [firstDay, ...events.map((e) => e.day)];
  const keys = new Set();
  const rows = days.map((day) => {
    const row = { day };
    for (const d of snapshot(day)) {
      if (!d.active) continue;
      const k = partyKey(d.gov);
      keys.add(k);
      row[k] = (row[k] || 0) + 1;
    }
    return row;
  });
  rows.push({ ...rows[rows.length - 1], day: lastDay });
  const order = [...keys].sort((a, b) => (a === NONE ? 55 : partyInfo(a).order) - (b === NONE ? 55 : partyInfo(b).order));
  for (const row of rows) for (const k of order) row[k] ||= 0;
  series = { rows, keys: order };
}

function renderTimeline() {
  const svg = d3.select('#timeline');
  const width = svg.node().clientWidth || 800, height = 96;
  const m = { l: 52, r: 8, t: 4, b: 18 };
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();
  x = d3.scaleLinear().domain([firstDay, lastDay]).range([m.l, width - m.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([height - m.b, m.t]);
  const stacked = d3.stack().keys(series.keys).offset(d3.stackOffsetExpand)(series.rows);
  const area = d3.area().curve(d3.curveStepAfter)
    .x((d) => x(d.data.day)).y0((d) => y(d[0])).y1((d) => y(d[1]))
    .defined((d) => Number.isFinite(d[0]) && Number.isFinite(d[1]));
  svg.append('g').selectAll('path').data(stacked).join('path').attr('d', area)
    .attr('fill', (s) => (s.key === NONE ? 'var(--vacant)' : colorOf(s.key)))
    .attr('fill-opacity', (s) => (s.key === NONE ? 0.5 : 0.92));
  svg.append('line').attr('class', 'half').attr('x1', m.l).attr('x2', width - m.r).attr('y1', y(0.5)).attr('y2', y(0.5));
  svg.append('text').attr('class', 'strip-label').attr('x', m.l - 6).attr('y', (height - m.b) / 2 + 4).attr('text-anchor', 'end').text('States');
  const years = d3.range(1780, new Date().getUTCFullYear() + 1, width < 640 ? 50 : 20);
  const axis = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.b + 2})`);
  axis.selectAll('text').data(years).join('text').attr('x', (yr) => x(toDay(`${yr}-01-01`))).attr('y', 11).attr('text-anchor', 'middle').text((yr) => yr);
  svg.append('line').attr('class', 'hover-line').attr('y1', m.t).attr('y2', height - m.b).style('display', 'none');
  svg.append('line').attr('class', 'cursor').attr('y1', m.t).attr('y2', height - m.b);
  updateCursor();
}

function updateCursor() {
  if (!x) return;
  d3.select('#timeline .cursor').attr('x1', x(state.day)).attr('x2', x(state.day));
}

function setupTimeline() {
  const svgEl = $('#timeline');
  const tipEl = $('#timeline-tip');
  const dayAt = (evt) => Math.round(Math.min(lastDay, Math.max(firstDay, x.invert(d3.pointer(evt, svgEl)[0]))));
  let dragging = false;
  svgEl.addEventListener('pointerdown', (evt) => { dragging = true; svgEl.setPointerCapture(evt.pointerId); stopPlaying(); setDay(dayAt(evt), false); });
  svgEl.addEventListener('pointerup', () => { dragging = false; });
  svgEl.addEventListener('pointermove', (evt) => {
    const day = dayAt(evt);
    if (dragging) setDay(day, false);
    d3.select('#timeline .hover-line').style('display', null).attr('x1', x(day)).attr('x2', x(day));
    const row = series.rows[Math.max(0, d3.bisector((r) => r.day).right(series.rows, day) - 1)];
    const parts = series.keys.filter((k) => row[k] > 0).sort((a, b) => row[b] - row[a]).slice(0, 5);
    tipEl.innerHTML = `<div class="muted">${fmtShort(day)}</div>${parts.map((k) => `<div class="row"><span>${k === NONE ? '<span class="swatch vacant"></span>' : swatch(k)} ${esc(k)}</span><span>${row[k]}</span></div>`).join('')}`;
    tipEl.hidden = false;
    const wrap = svgEl.parentElement.getBoundingClientRect();
    tipEl.style.top = `${svgEl.clientHeight + 4}px`;
    tipEl.style.left = `${Math.min(Math.max(0, evt.clientX - wrap.left - 90), wrap.width - 200)}px`;
  });
  svgEl.addEventListener('pointerleave', () => { tipEl.hidden = true; d3.select('#timeline .hover-line').style('display', 'none'); });
}

// ---------------------------------------------------------------- navigation

function stepTarget(kind, dir) {
  const day = state.day;
  if (kind === 'year') {
    const y = new Date(day * 864e5).getUTCFullYear();
    const jan1 = toDay(`${y}-01-01`);
    const target = dir > 0 ? toDay(`${y + 1}-01-01`) : (day > jan1 ? jan1 : toDay(`${y - 1}-01-01`));
    return target >= firstDay && target <= lastDay ? target : null;
  }
  const i = eventIndexAtOrBefore(events, day);
  if (dir > 0) return events[i + 1]?.day ?? null;
  const j = events[i]?.day === day ? i - 1 : i;
  return events[j]?.day ?? null;
}

let pending = null;
function setDay(day, animate = true) {
  state.day = Math.min(lastDay, Math.max(firstDay, day));
  if (pending) cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => { pending = null; render(animate); });
}

function render(animate) {
  const day = state.day;
  $('#slider').value = day;
  $('#date-input').value = fromDay(day);
  $('#date-heading').textContent = fmtDate(day);
  const tiles = snapshot(day);
  const active = tiles.filter((d) => d.active).length;
  $('#date-sub').textContent = `${active} ${active === 1 ? 'state' : 'states'}`;
  const changed = renderChanges(day);
  renderMap(tiles, changed, animate);
  renderTally(tiles);
  renderRoster(tiles);
  updateCursor();
  for (const btn of document.querySelectorAll('[data-step]')) btn.disabled = stepTarget(btn.dataset.step, Number(btn.dataset.dir)) === null;
  history.replaceState(null, '', `#${fromDay(day)}`);
  for (const a of document.querySelectorAll('a[data-nav]')) a.hash = fromDay(day);
}

function stopPlaying() {
  if (!state.playing) return;
  clearInterval(state.playing);
  state.playing = null;
  $('#play').setAttribute('aria-pressed', 'false');
  $('#play').textContent = '▶ Play';
}

function togglePlay() {
  if (state.playing) { stopPlaying(); return; }
  if (stepTarget('change', 1) === null) setDay(firstDay, false);
  $('#play').setAttribute('aria-pressed', 'true');
  $('#play').textContent = '❚❚ Pause';
  state.playing = setInterval(() => {
    const next = stepTarget('change', 1);
    if (next === null) { stopPlaying(); return; }
    setDay(next);
  }, 700);
}

function setupControls() {
  const slider = $('#slider');
  Object.assign(slider, { min: firstDay, max: lastDay, step: 1 });
  slider.addEventListener('input', () => { stopPlaying(); setDay(Number(slider.value), false); });
  const input = $('#date-input');
  Object.assign(input, { min: fromDay(firstDay), max: fromDay(lastDay) });
  input.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(input.value)) { stopPlaying(); setDay(toDay(input.value)); } });
  for (const btn of document.querySelectorAll('[data-step]')) {
    btn.addEventListener('click', () => {
      stopPlaying();
      const target = stepTarget(btn.dataset.step, Number(btn.dataset.dir));
      if (target !== null) setDay(target);
    });
  }
  $('#play').addEventListener('click', togglePlay);
  $('[data-role="roster"]').addEventListener('toggle', () => render(false));
  document.addEventListener('keydown', (evt) => {
    if (evt.target.closest('input, textarea, select') && evt.target.type !== 'range') return;
    if (historyDialog.open) return;
    const keys = { ArrowRight: ['change', 1], ArrowLeft: ['change', -1], PageDown: ['year', 1], PageUp: ['year', -1] };
    if (keys[evt.key]) {
      evt.preventDefault();
      stopPlaying();
      const target = stepTarget(...keys[evt.key]);
      if (target !== null) setDay(target);
    } else if (evt.key === ' ' && !evt.target.closest('button, summary, [role="button"]')) {
      evt.preventDefault();
      togglePlay();
    }
  });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderTimeline, 150); });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(h) && toDay(h) !== state.day) setDay(toDay(h));
  });
}

// ---------------------------------------------------------------- start

async function main() {
  if (!checkBuild()) return;
  try {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${SNAPSHOT_URL}`);
    data = await res.json();
  } catch (err) {
    console.error(err);
    statusEl.classList.add('error');
    statusEl.textContent = `Couldn't load the governor data: ${err.message}. Reload the page to try again.`;
    return;
  }
  buildModel();
  buildSeries();
  const h = location.hash.slice(1);
  state.day = /^\d{4}-\d{2}-\d{2}$/.test(h) ? Math.min(lastDay, Math.max(firstDay, toDay(h))) : today;
  statusEl.hidden = true;
  $('#app').hidden = false;
  setupControls();
  setupTimeline();
  setupHistory();
  renderTimeline();
  render(false);
}

main();
