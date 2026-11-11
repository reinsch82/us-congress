/* global d3, jsyaml */
import { buildModel, toDay, fromDay, congressOf, congressStart } from './model.js';
import { partyInfo } from './parties.js';

const REPO = 'unitedstates/congress-legislators';
const SNAPSHOT_URL = 'data/legislators.json';
const YAML_BASE = `https://raw.githubusercontent.com/${REPO}/main/`;
const JSON_BASE = 'https://unitedstates.github.io/congress-legislators/';
const YAML_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
const FILES = ['legislators-historical', 'legislators-current'];
const photoUrl = (id) => `https://unitedstates.github.io/images/congress/225x275/${id}.jpg`;
const bioguideUrl = (id) => `https://bioguide.congress.gov/search/bio/${id}`;

const $ = (sel, root = document) => root.querySelector(sel);
const statusEl = $('#status');
const today = toDay(new Date().toISOString().slice(0, 10));
const CHAMBERS = ['sen', 'rep'];

let model;
const state = { day: today, playing: null };

// ---------------------------------------------------------------- loading

async function fetchText(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received);
  }
  return new Blob(chunks).text();
}

const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(el);
  });
}

// The daily snapshot built by scripts/build-data.mjs and deployed with the page.
async function loadSnapshot() {
  const res = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${SNAPSHOT_URL}`);
  const { people, sources } = await res.json();
  return { people, sources };
}

// Straight from the upstream repository: the raw YAML on main, or its published JSON.
async function loadLive(report) {
  const received = FILES.map(() => 0);
  const progress = (i) => (n) => {
    received[i] = n;
    report(`Downloading legislator data from GitHub… ${(d3.sum(received) / 1e6).toFixed(1)} MB`);
  };
  try {
    const [texts] = await Promise.all([
      Promise.all(FILES.map((f, i) => fetchText(`${YAML_BASE}${f}.yaml`, progress(i)))),
      window.jsyaml ? null : loadScript(YAML_LIB),
    ]);
    report('Parsing YAML…');
    await yieldToBrowser();
    return { people: texts.flatMap((t) => jsyaml.load(t)), sources: null, label: 'YAML from the main branch' };
  } catch (err) {
    console.warn('Raw YAML failed, falling back to the published JSON', err);
    const texts = await Promise.all(FILES.map((f, i) => fetchText(`${JSON_BASE}${f}.json`, progress(i))));
    return { people: texts.flatMap((t) => JSON.parse(t)), sources: null, label: 'JSON from the gh-pages branch' };
  }
}

const fmtCommitDate = (iso) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
const commitLink = (src) => `<a href="https://github.com/${REPO}/commit/${src.sha}">${fmtCommitDate(src.date)}</a>`;

async function latestUpstream() {
  return Promise.all(FILES.map(async (f) => {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=main&path=${f}.yaml&per_page=1`);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const [c] = await res.json();
    return { sha: c.sha, date: c.commit.committer.date };
  }));
}

// Says where the data came from and, for the snapshot, offers newer data if there is any.
async function showFreshness({ sources, label }) {
  const el = $('#freshness');
  if (!sources) {
    el.textContent = `Loaded live ${label}.`;
    return;
  }
  const newest = FILES.map((f) => sources[f]).sort((a, b) => b.date.localeCompare(a.date))[0];
  el.innerHTML = `Daily snapshot, data last changed ${commitLink(newest)}.`;
  let upstream;
  try {
    upstream = await latestUpstream();
  } catch {
    // The GitHub API is rate-limited; without it we can't tell, so just offer the live data.
    el.insertAdjacentHTML('beforeend', ' <button type="button" class="link-button" id="load-live">Load live data</button>');
    $('#load-live').addEventListener('click', reloadLive);
    return;
  }
  if (FILES.some((f, i) => upstream[i].sha !== sources[f].sha)) {
    el.insertAdjacentHTML('beforeend', ' <strong>Newer data is available.</strong> <button type="button" class="link-button" id="load-live">Load it now</button>');
    $('#load-live').addEventListener('click', reloadLive);
  }
}

async function reloadLive() {
  stopPlaying();
  const el = $('#freshness');
  try {
    const data = await loadLive((msg) => { el.textContent = msg; });
    el.textContent = 'Building seat timelines…';
    await yieldToBrowser();
    useData(data.people);
    renderTimeline();
    render(false);
    showFreshness(data);
  } catch (err) {
    console.error(err);
    el.textContent = `Couldn't load live data: ${err.message}`;
  }
}

function useData(people) {
  model = buildModel(people, today);
  for (const chamber of CHAMBERS) timeline.series[chamber] = buildSeries(chamber);
}

// ---------------------------------------------------------------- helpers

const fmtDate = (day) => new Date(day * 864e5).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const fmtShort = (day) => new Date(day * 864e5).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const partyOf = (occ) => (occ ? occ.seg.party : 'Vacant');
const colorOf = (party) => (party === 'Vacant' ? 'transparent' : partyInfo(party).color);
const swatch = (party) => `<span class="swatch${party === 'Vacant' ? ' vacant' : ''}" style="background:${colorOf(party)}"></span>`;
const personName = (occ) => model.persons[occ.iv.pi].name;

// Last index i with list[i].day <= day, or -1.
function eventIndexAtOrBefore(list, day) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].day <= day) lo = mid + 1; else hi = mid - 1;
  }
  return hi;
}

// Where a member sits: party order, with caucusing independents next to their caucus.
function seatRank(entry) {
  if (!entry.occ) return partyInfo('Vacant').order;
  const { party, caucus } = entry.occ.seg;
  if (caucus && caucus !== party) {
    const o = partyInfo(caucus).order;
    return o + (o < 50 ? 1 : -1);
  }
  return partyInfo(party).order;
}

function sortSeats(entries) {
  return entries.slice().sort((a, b) =>
    seatRank(a) - seatRank(b)
    || partyOf(a.occ).localeCompare(partyOf(b.occ))
    || a.slot.state.localeCompare(b.slot.state)
    || a.slot.key.localeCompare(b.slot.key, undefined, { numeric: true }));
}

// ---------------------------------------------------------------- hemicycle geometry

const layoutCache = new Map();

// Seats on concentric arcs, the number per row proportional to its radius, then ordered
// by angle so that parties fill wedges from left to right.
function hemicycleLayout(n) {
  if (layoutCache.has(n)) return layoutCache.get(n);
  const r0 = 0.46;
  let rows = 2, gap, caps;
  for (;; rows++) {
    gap = (1 - r0) / (rows - 1);
    caps = d3.range(rows).map((i) => Math.floor((Math.PI * (r0 + i * gap)) / gap) + 1);
    if (d3.sum(caps) >= n || rows > 40) break;
  }
  const radii = d3.range(rows).map((i) => r0 + i * gap);
  const total = d3.sum(radii);
  const counts = radii.map((r, i) => Math.min(caps[i], Math.floor((n * r) / total)));
  let left = n - d3.sum(counts);
  for (let i = rows - 1; left > 0; i = (i - 1 + rows) % rows) {
    if (counts[i] < caps[i]) { counts[i]++; left--; }
  }
  const seats = [];
  counts.forEach((m, i) => {
    for (let j = 0; j < m; j++) {
      const a = m === 1 ? Math.PI / 2 : Math.PI * (1 - j / (m - 1));
      seats.push({ x: 100 * radii[i] * Math.cos(a), y: -100 * radii[i] * Math.sin(a), a, r: radii[i] });
    }
  });
  seats.sort((p, q) => q.a - p.a || q.r - p.r);
  const out = { seats, dot: 100 * Math.min(gap * 0.42, 0.07) };
  layoutCache.set(n, out);
  return out;
}

// ---------------------------------------------------------------- tooltips

const seatTip = $('#seat-tip');

function describeOcc(slot, occ) {
  if (!occ) return `<div class="name">Vacant</div><div class="muted">${esc(slot.label)}</div>`;
  const p = model.persons[occ.iv.pi];
  const { party, caucus } = occ.seg;
  const until = occ.iv.e > today ? `term ends ${fmtShort(occ.iv.e)}` : fmtShort(occ.iv.e);
  const lines = [
    `<div class="name">${esc(p.name)}</div>`,
    `<div class="line">${swatch(party)} ${esc(party)}${caucus && caucus !== party ? ` <span class="muted">(caucuses with ${esc(caucus)}s)</span>` : ''}</div>`,
    `<div>${esc(slot.label)}</div>`,
    `<div class="muted">In this seat ${fmtShort(occ.iv.s)} – ${until}${occ.iv.how ? ` (${esc(occ.iv.how.replace('-', ' '))})` : ''}</div>`,
  ];
  if (occ.iv.also) {
    lines.push(`<div class="muted">Also held this seat during this term: ${occ.iv.also.map((pi) => esc(model.persons[pi].name)).join(', ')}. The source data doesn't record when the seat changed hands.</div>`);
  }
  return `<img alt="" src="${photoUrl(p.bioguide)}" onerror="this.remove()">${lines.join('')}`;
}

function showSeatTip(evt, slot, occ) {
  seatTip.innerHTML = describeOcc(slot, occ);
  seatTip.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  const rect = seatTip.getBoundingClientRect();
  let x = evt.clientX + 14, y = evt.clientY + 14;
  if (x + rect.width > w - 8) x = evt.clientX - rect.width - 14;
  if (y + rect.height > h - 8) y = evt.clientY - rect.height - 14;
  seatTip.style.left = `${Math.max(8, x)}px`;
  seatTip.style.top = `${Math.max(8, y)}px`;
}
const hideSeatTip = () => { seatTip.hidden = true; };

// ---------------------------------------------------------------- chamber rendering

function majorityText(chamber, entries) {
  const seats = entries.length;
  const need = Math.floor(seats / 2) + 1;
  const blocs = new Map();
  for (const { occ } of entries) {
    if (!occ) continue;
    const bloc = occ.seg.caucus || occ.seg.party;
    blocs.set(bloc, (blocs.get(bloc) || 0) + 1);
  }
  const [leader, n] = [...blocs].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  if (!leader) return 'No members';
  if (n >= need) {
    const pure = entries.filter((e) => e.occ && e.occ.seg.party === leader).length;
    const extra = n - pure;
    return `<strong>${esc(leader)} majority</strong> ${n} of ${seats}${extra ? `, incl. ${extra} caucusing` : ''}`;
  }
  if (chamber === 'sen' && n * 2 === seats) return `<strong>Evenly split</strong> ${n}–${n}, the Vice President breaks ties`;
  return `<strong>No majority</strong> largest is ${esc(leader)} with ${n} of ${seats}, ${need} needed`;
}

function renderTally(el, entries) {
  const counts = d3.rollups(entries, (v) => v.length, (e) => partyOf(e.occ));
  counts.sort((a, b) => (a[0] === 'Vacant') - (b[0] === 'Vacant') || b[1] - a[1]);
  el.innerHTML = counts.map(([p, n]) => `<span class="chip">${swatch(p)}${esc(p)} <b>${n}</b></span>`).join('');
}

function changeLine(c) {
  const { before, after } = c;
  const seat = `<span class="seat-name">${esc(c.slot.label)}</span>`;
  const who = (o) => `${esc(personName(o))} (${esc(o.seg.party)})`;
  let text;
  if (c.created && after) text = `New seat: ${who(after)}`;
  else if (c.removed) text = `Seat not filled in this Congress${before ? ` (last held by ${who(before)})` : ''}`;
  else if (before && after && before.iv.pi === after.iv.pi) text = `${esc(personName(after))} switched from ${esc(before.seg.party)} to ${esc(after.seg.party)}`;
  else if (before && after) text = `${who(after)} succeeded ${who(before)}`;
  else if (after) text = `${who(after)} took the seat${after.iv.how === 'appointment' ? ' by appointment' : after.iv.how === 'special-election' ? ' after a special election' : ''}`;
  else text = `${who(before)} left; seat vacant`;
  return `<li data-slot="${c.slot.id}">${swatch(partyOf(after))}<span>${text} ${seat}</span></li>`;
}

function renderChanges(el, chamber, day) {
  const list = model.events[chamber];
  const i = eventIndexAtOrBefore(list, day);
  if (i < 0) { el.innerHTML = ''; return new Set(); }
  const ev = list[i];
  const net = new Map();
  for (const c of ev.changes) {
    if (c.before) net.set(c.before.seg.party, (net.get(c.before.seg.party) || 0) - 1);
    if (c.after) net.set(c.after.seg.party, (net.get(c.after.seg.party) || 0) + 1);
  }
  const netText = [...net].filter(([, v]) => v).sort((a, b) => b[1] - a[1])
    .map(([p, v]) => `${esc(p)} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join(', ');
  const isNewCongress = congressStart(congressOf(ev.day)) === ev.day;
  const heading = ev.day === day ? 'Changes on this day' : `Most recent change: ${fmtDate(ev.day)}`;
  const shown = 12;
  const items = ev.changes.map(changeLine);
  el.innerHTML = `
    <h3>${heading}${isNewCongress ? `. The ${ordinal(congressOf(ev.day))} Congress begins.` : ''}</h3>
    ${ev.changes.length > 1 ? `<p class="net">${ev.changes.length} seats changed${netText ? `. Net: ${netText}` : ', no net party change'}. New members are ringed.</p>` : ''}
    <ul>${items.slice(0, shown).join('')}</ul>
    ${items.length > shown ? `<details><summary>Show ${items.length - shown} more</summary><ul>${items.slice(shown).join('')}</ul></details>` : ''}`;
  return new Set(ev.changes.filter((c) => c.after).map((c) => c.slot.id));
}

function renderRoster(details, entries, chamber) {
  if (!details.open) return;
  const rows = entries.slice().sort((a, b) => a.slot.state.localeCompare(b.slot.state) || a.slot.key.localeCompare(b.slot.key, undefined, { numeric: true }));
  $('div', details).innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Seat</th><th>${chamber === 'sen' ? 'Senator' : 'Representative'}</th><th>Party</th></tr></thead>
    <tbody>${rows.map(({ slot, occ }) => `<tr><td>${esc(slot.label)}</td><td>${occ ? esc(personName(occ)) : '<span class="muted">Vacant</span>'}</td><td>${occ ? `${swatch(occ.seg.party)} ${esc(occ.seg.party)}` : ''}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderHemicycle(svgEl, entries, ringed, animate) {
  const svg = d3.select(svgEl);
  const sorted = sortSeats(entries);
  const { seats, dot } = hemicycleLayout(sorted.length);
  const data = sorted.map((e, i) => ({ ...e, pos: seats[i] }));
  const t = svg.transition().duration(animate ? 650 : 0).ease(d3.easeCubicInOut);

  svg.attr('aria-label', `${entries.length} seats`);

  svg.selectAll('circle.seat')
    .data(data, (d) => d.slot.id)
    .join(
      (enter) => enter.append('circle')
        .attr('class', 'seat')
        .attr('cx', (d) => d.pos.x).attr('cy', (d) => d.pos.y)
        .attr('r', 0),
      (update) => update,
      (exit) => exit.transition(t).attr('r', 0).remove(),
    )
    .classed('vacant', (d) => !d.occ)
    .attr('stroke-width', (d) => (d.occ ? 0 : dot * 0.25))
    .on('pointerenter pointermove', (evt, d) => showSeatTip(evt, d.slot, d.occ))
    .on('pointerleave', hideSeatTip)
    .on('click', (evt, d) => { if (d.occ) window.open(bioguideUrl(model.persons[d.occ.iv.pi].bioguide), '_blank', 'noopener'); })
    .transition(t)
    .attr('cx', (d) => d.pos.x).attr('cy', (d) => d.pos.y)
    .attr('r', (d) => (d.occ ? dot : dot * 0.85))
    .attr('fill', (d) => (d.occ ? colorOf(d.occ.seg.party) : null));

  svg.selectAll('circle.ring')
    .data(data.filter((d) => ringed.has(d.slot.id)), (d) => d.slot.id)
    .join((enter) => enter.append('circle').attr('class', 'ring')
      .attr('cx', (d) => d.pos.x).attr('cy', (d) => d.pos.y))
    .attr('stroke-width', dot * 0.2)
    .transition(t)
    .attr('cx', (d) => d.pos.x).attr('cy', (d) => d.pos.y)
    .attr('r', dot * 1.22);

  const need = Math.floor(entries.length / 2) + 1;
  svg.selectAll('text.total').data([0]).join('text').attr('class', 'total').attr('y', -8).text(entries.length);
  svg.selectAll('text.total-sub').data([0]).join('text').attr('class', 'total-sub').attr('y', 1).text(`seats, ${need} for a majority`);
  svg.selectAll('line.majority-tick').data([0]).join('line').attr('class', 'majority-tick')
    .attr('x1', 0).attr('x2', 0).attr('y1', -38).attr('y2', -105)
    .attr('vector-effect', 'non-scaling-stroke');
  svg.select('line.majority-tick').lower();
}

function renderDelegates(day) {
  const el = $('#delegates');
  const on = $('#show-delegates').checked;
  el.hidden = !on;
  if (!on) return;
  const entries = sortSeats(model.snapshot('del', day));
  el.innerHTML = entries.length
    ? `<span>Non-voting delegates (${entries.length}):</span>`
    : '<span class="muted">No non-voting delegates on this date.</span>';
  for (const e of entries) {
    const d = document.createElement('span');
    d.className = 'dot';
    d.style.background = e.occ ? colorOf(e.occ.seg.party) : 'transparent';
    if (!e.occ) d.style.boxShadow = 'inset 0 0 0 1.5px var(--vacant)';
    d.addEventListener('pointerenter', (evt) => showSeatTip(evt, e.slot, e.occ));
    d.addEventListener('pointermove', (evt) => showSeatTip(evt, e.slot, e.occ));
    d.addEventListener('pointerleave', hideSeatTip);
    el.append(d);
  }
}

// ---------------------------------------------------------------- timeline

const timeline = { series: {}, x: null };

function buildSeries(chamber) {
  const days = [...new Set([model.firstDay, ...model.events[chamber].map((e) => e.day)])].sort((a, b) => a - b);
  const keys = new Set();
  const rows = days.map((day) => {
    const row = { day };
    for (const { occ } of model.snapshot(chamber, day)) {
      const k = partyOf(occ);
      keys.add(k);
      row[k] = (row[k] || 0) + 1;
    }
    return row;
  });
  rows.push({ ...rows[rows.length - 1], day: model.lastDay });
  const order = [...keys].sort((a, b) => partyInfo(a).order - partyInfo(b).order);
  for (const row of rows) for (const k of order) row[k] ||= 0;
  return { rows, keys: order };
}

function renderTimeline() {
  const svg = d3.select('#timeline');
  const width = svg.node().clientWidth || 800;
  const height = 150;
  const m = { l: 52, r: 8, t: 4, b: 18 };
  const stripH = (height - m.t - m.b - 8) / 2;
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();

  const x = d3.scaleLinear().domain([model.firstDay, model.lastDay]).range([m.l, width - m.r]);
  timeline.x = x;

  CHAMBERS.forEach((chamber, i) => {
    const { rows, keys } = timeline.series[chamber];
    const top = m.t + i * (stripH + 8);
    const y = d3.scaleLinear().domain([0, 1]).range([top + stripH, top]);
    const stacked = d3.stack().keys(keys).offset(d3.stackOffsetExpand)(rows);
    const area = d3.area().curve(d3.curveStepAfter)
      .x((d) => x(d.data.day)).y0((d) => y(d[0])).y1((d) => y(d[1]))
      .defined((d) => Number.isFinite(d[0]) && Number.isFinite(d[1]));
    const g = svg.append('g');
    g.selectAll('path').data(stacked).join('path')
      .attr('d', area)
      .attr('fill', (s) => (s.key === 'Vacant' ? 'var(--vacant)' : colorOf(s.key)))
      .attr('fill-opacity', (s) => (s.key === 'Vacant' ? 0.5 : 0.92));
    g.append('line').attr('class', 'half').attr('x1', m.l).attr('x2', width - m.r).attr('y1', y(0.5)).attr('y2', y(0.5));
    g.append('text').attr('class', 'strip-label').attr('x', m.l - 6).attr('y', top + stripH / 2 + 4).attr('text-anchor', 'end')
      .text(chamber === 'sen' ? 'Senate' : 'House');
  });

  const years = d3.range(1790, new Date().getUTCFullYear() + 1, width < 640 ? 50 : 20);
  const axis = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.b + 2})`);
  axis.selectAll('text').data(years).join('text')
    .attr('x', (yr) => x(toDay(`${yr}-01-01`))).attr('y', 11).attr('text-anchor', 'middle').text((yr) => yr);
  axis.selectAll('line').data(years).join('line')
    .attr('x1', (yr) => x(toDay(`${yr}-01-01`))).attr('x2', (yr) => x(toDay(`${yr}-01-01`))).attr('y1', -2).attr('y2', 1);

  svg.append('line').attr('class', 'hover-line').attr('y1', m.t).attr('y2', height - m.b).style('display', 'none');
  svg.append('line').attr('class', 'cursor').attr('y1', m.t).attr('y2', height - m.b);
  updateTimelineCursor();
}

function updateTimelineCursor() {
  if (!timeline.x) return;
  const cx = timeline.x(state.day);
  d3.select('#timeline .cursor').attr('x1', cx).attr('x2', cx);
}

function rowAt(chamber, day) {
  const rows = timeline.series[chamber].rows;
  const i = Math.max(0, d3.bisector((r) => r.day).right(rows, day) - 1);
  return rows[i];
}

function setupTimelineInteraction() {
  const svgEl = $('#timeline');
  const tip = $('#timeline-tip');
  const dayFromEvent = (evt) => {
    const [px] = d3.pointer(evt, svgEl);
    return Math.round(Math.min(model.lastDay, Math.max(model.firstDay, timeline.x.invert(px))));
  };
  let dragging = false;
  svgEl.addEventListener('pointerdown', (evt) => {
    dragging = true;
    svgEl.setPointerCapture(evt.pointerId);
    stopPlaying();
    setDay(dayFromEvent(evt), false);
  });
  svgEl.addEventListener('pointerup', () => { dragging = false; });
  svgEl.addEventListener('pointermove', (evt) => {
    const day = dayFromEvent(evt);
    if (dragging) setDay(day, false);
    const hx = timeline.x(day);
    d3.select('#timeline .hover-line').style('display', null).attr('x1', hx).attr('x2', hx);
    const block = (ch) => {
      const row = rowAt(ch, day);
      const parts = timeline.series[ch].keys.filter((k) => row[k] > 0).sort((a, b) => row[b] - row[a]).slice(0, 4);
      return `<div><b>${ch === 'sen' ? 'Senate' : 'House'}</b></div>${parts.map((k) => `<div class="row"><span>${swatch(k)} ${esc(k)}</span><span>${row[k]}</span></div>`).join('')}`;
    };
    tip.innerHTML = `<div class="muted">${fmtShort(day)}</div>${block('sen')}${block('rep')}`;
    tip.hidden = false;
    const wrap = svgEl.parentElement.getBoundingClientRect();
    const left = evt.clientX - wrap.left;
    tip.style.top = `${svgEl.clientHeight + 4}px`;
    tip.style.left = `${Math.min(Math.max(0, left - 90), wrap.width - 200)}px`;
  });
  svgEl.addEventListener('pointerleave', () => {
    tip.hidden = true;
    d3.select('#timeline .hover-line').style('display', 'none');
  });
}

// ---------------------------------------------------------------- navigation

function stepTarget(kind, dir) {
  const day = state.day;
  if (kind === 'congress') {
    const c = congressOf(day);
    if (dir > 0) return congressStart(c + 1) <= model.lastDay ? congressStart(c + 1) : null;
    return day > congressStart(c) ? congressStart(c) : (c > 1 ? congressStart(c - 1) : null);
  }
  const lists = kind === 'any' ? CHAMBERS.map((c) => model.events[c]) : [model.events[kind]];
  const candidates = lists.map((list) => {
    const i = eventIndexAtOrBefore(list, day);
    if (dir > 0) return list[i + 1]?.day ?? null;
    const j = list[i]?.day === day ? i - 1 : i;
    return list[j]?.day ?? null;
  }).filter((d) => d !== null);
  if (!candidates.length) return null;
  return dir > 0 ? Math.min(...candidates) : Math.max(...candidates);
}

function updateStepButtons() {
  for (const btn of document.querySelectorAll('[data-step]')) {
    const target = stepTarget(btn.dataset.step, Number(btn.dataset.dir));
    btn.disabled = target === null;
    if (btn.dataset.step !== 'congress' && btn.dataset.step !== 'any') {
      btn.title = target === null ? 'No more changes' : `${Number(btn.dataset.dir) > 0 ? 'Next' : 'Previous'} change: ${fmtShort(target)}`;
    }
  }
}

let pending = null;
function setDay(day, animate = true) {
  state.day = Math.min(model.lastDay, Math.max(model.firstDay, day));
  if (pending) cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => { pending = null; render(animate); });
}

function render(animate) {
  const day = state.day;
  const c = congressOf(day);
  const startYear = new Date(congressStart(c) * 864e5).getUTCFullYear();
  $('#slider').value = day;
  $('#date-input').value = fromDay(day);
  $('#congress-label').textContent = `${ordinal(c)} Congress, ${startYear}–${startYear + 2}`;
  $('#date-heading').textContent = fmtDate(day);

  for (const chamber of CHAMBERS) {
    const root = document.getElementById(chamber);
    const entries = model.snapshot(chamber, day);
    $('[data-role="majority"]', root).innerHTML = majorityText(chamber, entries);
    renderTally($('[data-role="tally"]', root), entries);
    const ringed = renderChanges($('[data-role="changes"]', root), chamber, day);
    renderHemicycle($('[data-role="hemicycle"]', root), entries, ringed, animate);
    renderRoster($('[data-role="roster"]', root), entries, chamber);
  }
  renderDelegates(day);
  updateTimelineCursor();
  updateStepButtons();
  history.replaceState(null, '', `#${fromDay(day)}`);
}

function stopPlaying() {
  if (!state.playing) return;
  clearInterval(state.playing);
  state.playing = null;
  const btn = $('#play');
  btn.setAttribute('aria-pressed', 'false');
  btn.textContent = '▶ Play';
}

function togglePlay() {
  if (state.playing) { stopPlaying(); return; }
  if (stepTarget('any', 1) === null) setDay(model.firstDay, false);
  const btn = $('#play');
  btn.setAttribute('aria-pressed', 'true');
  btn.textContent = '❚❚ Pause';
  state.playing = setInterval(() => {
    const next = stepTarget('any', 1);
    if (next === null) { stopPlaying(); return; }
    setDay(next, true);
  }, 900);
}

function setupControls() {
  const slider = $('#slider');
  slider.min = model.firstDay;
  slider.max = model.lastDay;
  slider.step = 1;
  slider.addEventListener('input', () => { stopPlaying(); setDay(Number(slider.value), false); });

  const dateInput = $('#date-input');
  dateInput.min = fromDay(model.firstDay);
  dateInput.max = fromDay(model.lastDay);
  dateInput.addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) { stopPlaying(); setDay(toDay(dateInput.value)); }
  });

  for (const btn of document.querySelectorAll('[data-step]')) {
    btn.addEventListener('click', () => {
      stopPlaying();
      const target = stepTarget(btn.dataset.step, Number(btn.dataset.dir));
      if (target !== null) setDay(target);
    });
  }
  $('#play').addEventListener('click', togglePlay);
  $('#show-delegates').addEventListener('change', () => render(false));
  for (const d of document.querySelectorAll('[data-role="roster"]')) d.addEventListener('toggle', () => render(false));

  document.addEventListener('keydown', (evt) => {
    if (evt.target.closest('input, textarea, select') && evt.target.type !== 'range') return;
    const keys = { ArrowRight: ['any', 1], ArrowLeft: ['any', -1], PageDown: ['congress', 1], PageUp: ['congress', -1] };
    if (keys[evt.key]) {
      evt.preventDefault();
      stopPlaying();
      const target = stepTarget(...keys[evt.key]);
      if (target !== null) setDay(target);
    } else if (evt.key === ' ' && !evt.target.closest('button, summary')) {
      evt.preventDefault();
      togglePlay();
    }
  });

  // Hovering a line in a change list points at the seat in the chart.
  for (const chamber of CHAMBERS) {
    const root = document.getElementById(chamber);
    const changes = $('[data-role="changes"]', root);
    changes.addEventListener('pointerover', (evt) => {
      const li = evt.target.closest('li[data-slot]');
      d3.select($('[data-role="hemicycle"]', root)).selectAll('circle.seat')
        .attr('opacity', li ? (d) => (String(d.slot.id) === li.dataset.slot ? 1 : 0.25) : null);
    });
    changes.addEventListener('pointerleave', () => {
      d3.select($('[data-role="hemicycle"]', root)).selectAll('circle.seat').attr('opacity', null);
    });
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderTimeline, 150);
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(h) && toDay(h) !== state.day) setDay(toDay(h));
  });
}

// ---------------------------------------------------------------- start

async function main() {
  let data;
  try {
    statusEl.textContent = 'Loading legislator data…';
    data = await loadSnapshot();
  } catch (err) {
    console.warn('No snapshot, loading live data instead', err);
    try {
      data = await loadLive((msg) => { statusEl.textContent = msg; });
    } catch (liveErr) {
      console.error(liveErr);
      statusEl.classList.add('error');
      statusEl.textContent = `Couldn't load the data: ${liveErr.message}`;
      return;
    }
  }
  statusEl.textContent = `Building seat timelines for ${data.people.length.toLocaleString()} legislators…`;
  await yieldToBrowser();
  useData(data.people);

  const h = location.hash.slice(1);
  state.day = /^\d{4}-\d{2}-\d{2}$/.test(h) ? Math.min(today, Math.max(model.firstDay, toDay(h))) : today;

  statusEl.hidden = true;
  $('#app').hidden = false;
  setupControls();
  setupTimelineInteraction();
  renderTimeline();
  render(false);
  showFreshness(data);
}

main();
