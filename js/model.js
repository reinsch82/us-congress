// Turns the person records of unitedstates/congress-legislators into per-seat timelines,
// so we can ask "who held every seat on day X" and "what changed on day X".
//
// Days are integers (days since 1970-01-01, UTC) so comparisons are cheap.
// A service interval [s, e) includes day s and excludes day e.

import { normaliseParty } from './parties.js';

const MS_PER_DAY = 864e5;
export const toDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
};
export const fromDay = (n) => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);

// Before the 20th Amendment a Congress ran from March 4 of odd years; from the 74th on, January 3.
export function congressStart(n) {
  return n <= 73 ? toDay(`${1789 + 2 * (n - 1)}-03-04`) : toDay(`${1935 + 2 * (n - 74)}-01-03`);
}
export function congressOf(day) {
  let n = Math.max(1, Math.floor((new Date(day * MS_PER_DAY).getUTCFullYear() - 1789) / 2) + 1);
  while (n > 1 && congressStart(n) > day) n--;
  while (congressStart(n + 1) <= day) n++;
  return n;
}

export const STATEHOOD = Object.fromEntries(Object.entries({
  DE: '1787-12-07', PA: '1787-12-12', NJ: '1787-12-18', GA: '1788-01-02', CT: '1788-01-09',
  MA: '1788-02-06', MD: '1788-04-28', SC: '1788-05-23', NH: '1788-06-21', VA: '1788-06-25',
  NY: '1788-07-26', NC: '1789-11-21', RI: '1790-05-29', VT: '1791-03-04', KY: '1792-06-01',
  TN: '1796-06-01', OH: '1803-03-01', LA: '1812-04-30', IN: '1816-12-11', MS: '1817-12-10',
  IL: '1818-12-03', AL: '1819-12-14', ME: '1820-03-15', MO: '1821-08-10', AR: '1836-06-15',
  MI: '1837-01-26', FL: '1845-03-03', TX: '1845-12-29', IA: '1846-12-28', WI: '1848-05-29',
  CA: '1850-09-09', MN: '1858-05-11', OR: '1859-02-14', KS: '1861-01-29', WV: '1863-06-20',
  NV: '1864-10-31', NE: '1867-03-01', CO: '1876-08-01', ND: '1889-11-02', SD: '1889-11-02',
  MT: '1889-11-08', WA: '1889-11-11', ID: '1890-07-03', WY: '1890-07-10', UT: '1896-01-04',
  OK: '1907-11-16', NM: '1912-01-06', AZ: '1912-02-14', AK: '1959-01-03', HI: '1959-08-21',
}).map(([k, v]) => [k, toDay(v)]));

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia', PR: 'Puerto Rico', GU: 'Guam',
  VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
  PI: 'Philippines', DK: 'Dakota Territory', OL: 'Territory of Orleans',
};

const FIRST_GOP_DAY = toDay('1840-01-01');
// Territories that sent more than one delegate at a time.
const MULTI_DELEGATE = new Set(['PI']);

function personName(n) {
  if (n.official_full) return n.official_full;
  return [n.first, n.nickname ? `“${n.nickname}”` : null, n.last].filter(Boolean).join(' ')
    + (n.suffix ? `, ${n.suffix}` : '');
}

function chamberOf(t, start) {
  if (t.type === 'sen') return 'sen';
  const admitted = STATEHOOD[t.state];
  // Some first representatives of a new state were seated a little before formal admission.
  return admitted !== undefined && start >= admitted - 60 ? 'rep' : 'del';
}

function seatKey(chamber, t) {
  if (chamber === 'sen') return { key: `${t.state}|S${t.class}`, multi: false };
  if (chamber === 'del') return { key: `${t.state}|DEL`, multi: MULTI_DELEGATE.has(t.state) };
  // district -1: members elected statewide on a general ticket, several at once.
  if (t.district === -1) return { key: `${t.state}|GT`, multi: true };
  const district = t.district ?? 0;
  return { key: `${t.state}|${district}`, multi: district === 0 };
}

function seatLabel(chamber, state, key) {
  const part = key.split('|')[1];
  if (chamber === 'sen') return `${STATE_NAMES[state] || state} · Class ${part.slice(1)}`;
  if (chamber === 'del') return `${STATE_NAMES[state] || state} · Delegate`;
  if (part.startsWith('GT') || part === '0') return `${STATE_NAMES[state] || state} · At-large`;
  return `${STATE_NAMES[state] || state} · District ${part}`;
}

function clipSegments(term) {
  term.segs = term.segs
    .map((g) => ({ ...g, s: Math.max(g.s, term.s), e: Math.min(g.e, term.e) }))
    .filter((g) => g.e > g.s);
  if (!term.segs.length) term.segs = [{ s: term.s, e: term.e, party: term.party0, caucus: null }];
}

// Make one seat's terms non-overlapping. In older records a member who died or resigned
// and their successor are often both listed for the full Congress; we keep the clearest
// reading of the data and attach anyone we cannot place to the interval they shared.
function resolveSingleSeat(terms) {
  terms.sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  for (const t of terms) {
    const last = out[out.length - 1];
    if (!last || t.s >= last.e) { out.push(t); continue; }
    if (t.s < last.s) t.s = last.s;
    if (t.s > last.s) {
      last.e = t.s;
      clipSegments(last);
      out.push(t);
    } else if (t.e > last.e) {
      t.s = last.e;
      clipSegments(t);
      out.push(t);
    } else if (t.e < last.e) {
      // Same start, t leaves first: t was the predecessor.
      out[out.length - 1] = t;
      last.s = t.e;
      clipSegments(last);
      out.push(last);
    } else {
      // Identical dates. If the previous interval was t's, t is the incumbent.
      const prev = out[out.length - 2];
      let keep = last, other = t;
      if (prev && prev.pi === t.pi && prev.pi !== last.pi) { keep = t; other = last; }
      keep.also = [...(keep.also || []), other.pi, ...(other.also || [])];
      out[out.length - 1] = keep;
    }
  }
  return [out];
}

// At-large seats can be held by several members at once (e.g. North Dakota's two
// at-large representatives). Members overlapping from the start of a Congress get their
// own seat; a member starting mid-Congress is taken to replace whoever overlaps them.
function resolveMultiSeat(terms) {
  terms.sort((a, b) => a.s - b.s || a.e - b.e);
  const lanes = [];
  for (const t of terms) {
    let lane = lanes.find((l) => l[l.length - 1].e <= t.s);
    if (!lane && t.s > congressStart(congressOf(t.s))) {
      const overlapping = lanes.filter((l) => l[l.length - 1].s < t.s);
      lane = overlapping.sort((a, b) => a[a.length - 1].s - b[b.length - 1].s)[0];
      if (lane) {
        const last = lane[lane.length - 1];
        last.e = t.s;
        clipSegments(last);
      }
    }
    if (!lane) lanes.push((lane = []));
    lane.push(t);
  }
  return lanes;
}

export function buildModel(people, today) {
  const persons = [];
  const raw = [];

  for (const p of people) {
    const pi = persons.length;
    persons.push({
      bioguide: p.id.bioguide,
      name: personName(p.name),
    });
    for (const t of p.terms) {
      let s = toDay(t.start);
      let e = toDay(t.end);
      // Terms that end the day before a new Congress convenes end with that Congress.
      if (congressStart(congressOf(e + 1)) === e + 1) e += 1;
      if (e <= s) continue;
      const chamber = chamberOf(t, s);
      const { key, multi } = seatKey(chamber, t);
      const segs = (t.party_affiliations?.length ? t.party_affiliations : [{ start: t.start, end: t.end, party: t.party }])
        .map((a) => {
          const as = toDay(a.start);
          return { s: as, e: toDay(a.end), party: normaliseParty(a.party, as, FIRST_GOP_DAY), caucus: t.caucus || null };
        });
      segs[segs.length - 1].e = Math.max(segs[segs.length - 1].e, e);
      raw.push({
        pi, s, e, chamber, key, multi, state: t.state, segs,
        party0: normaliseParty(t.party, s, FIRST_GOP_DAY),
        how: t.how || null,
      });
    }
  }

  // Old records start members on the day the first session convened, not the day the
  // Congress legally began, which would leave every seat "vacant" for months. The most
  // common start date inside a Congress is that first sitting; move those back.
  const startCounts = new Map();
  for (const t of raw) {
    const c = congressOf(t.s);
    const m = startCounts.get(c) || new Map();
    m.set(t.s, (m.get(t.s) || 0) + 1);
    startCounts.set(c, m);
  }
  const firstSitting = new Map();
  for (const [c, m] of startCounts) {
    let best = null, n = 0;
    for (const [d, k] of m) if (k > n) { best = d; n = k; }
    firstSitting.set(c, best);
  }
  for (const t of raw) {
    const c = congressOf(t.s);
    if (t.s === firstSitting.get(c) && t.s !== congressStart(c)) {
      t.s = congressStart(c);
      t.segs[0].s = Math.min(t.segs[0].s, t.s);
    }
    clipSegments(t);
  }

  // Group terms into seats ("slots") and resolve overlaps.
  const byKey = new Map();
  for (const t of raw) {
    if (!byKey.has(t.key)) byKey.set(t.key, []);
    byKey.get(t.key).push(t);
  }
  const slots = [];
  for (const [key, terms] of byKey) {
    const { chamber, state, multi } = terms[0];
    const lanes = multi ? resolveMultiSeat(terms) : resolveSingleSeat(terms);
    lanes.forEach((ivs, i) => {
      slots.push({
        id: slots.length,
        key: lanes.length > 1 ? `${key}#${i + 1}` : key,
        chamber, state,
        label: seatLabel(chamber, state, key) + (lanes.length > 1 ? ` (seat ${i + 1})` : ''),
        admitted: STATEHOOD[state] ?? -Infinity,
        ivs: ivs.map(({ pi, s, e, segs, how, also }) => ({ pi, s, e, segs, how, also: also || null })),
      });
    });
  }

  const lastDay = today;
  const lastCongress = congressOf(lastDay);

  // Which seats exist in each Congress: any seat somebody occupied during it.
  const seatsInCongress = { sen: [], rep: [], del: [] };
  for (const ch of Object.keys(seatsInCongress)) {
    for (let c = 0; c <= lastCongress + 1; c++) seatsInCongress[ch].push(new Set());
  }
  for (const slot of slots) {
    for (const iv of slot.ivs) {
      const c0 = congressOf(iv.s), c1 = Math.min(congressOf(iv.e - 1), lastCongress + 1);
      for (let c = c0; c <= c1; c++) seatsInCongress[slot.chamber][c].add(slot.id);
    }
  }
  for (const ch of Object.keys(seatsInCongress)) {
    seatsInCongress[ch] = seatsInCongress[ch].map((set) => [...set]);
  }

  function occupant(slot, day) {
    const ivs = slot.ivs;
    let lo = 0, hi = ivs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ivs[mid].s <= day) lo = mid + 1; else hi = mid - 1;
    }
    const iv = ivs[hi];
    if (!iv || iv.e <= day) return null;
    const seg = iv.segs.find((g) => g.s <= day && day < g.e) || iv.segs[iv.segs.length - 1];
    return { iv, seg };
  }

  function seatExists(slot, day) {
    return slot.admitted <= day && seatsInCongress[slot.chamber][congressOf(day)].includes(slot.id);
  }

  // Every seat of a chamber on a given day, with its occupant (null = vacant).
  function snapshot(chamber, day) {
    const out = [];
    for (const id of seatsInCongress[chamber][congressOf(day)] || []) {
      const slot = slots[id];
      if (slot.admitted > day) continue;
      out.push({ slot, occ: occupant(slot, day) });
    }
    return out;
  }

  // All days on which a chamber's composition changes, with what changed.
  const events = {};
  for (const chamber of ['sen', 'rep', 'del']) {
    const touched = new Map();
    const touch = (day, id) => {
      if (day > lastDay) return;
      if (!touched.has(day)) touched.set(day, new Set());
      touched.get(day).add(id);
    };
    for (const slot of slots) {
      if (slot.chamber !== chamber) continue;
      for (const iv of slot.ivs) {
        touch(iv.s, slot.id); touch(iv.e, slot.id);
        for (const g of iv.segs) touch(g.s, slot.id);
      }
      if (slot.admitted > -Infinity) touch(slot.admitted, slot.id);
    }
    const list = [];
    for (const day of [...touched.keys()].sort((a, b) => a - b)) {
      const changes = [];
      for (const id of touched.get(day)) {
        const slot = slots[id];
        const existedBefore = seatExists(slot, day - 1), existsNow = seatExists(slot, day);
        const before = existedBefore ? occupant(slot, day - 1) : null;
        const after = existsNow ? occupant(slot, day) : null;
        const same = before && after && before.iv.pi === after.iv.pi && before.seg.party === after.seg.party;
        if (same || (!before && !after && existedBefore === existsNow)) continue;
        changes.push({ slot, before, after, created: !existedBefore && existsNow, removed: existedBefore && !existsNow });
      }
      if (changes.length) list.push({ day, changes });
    }
    events[chamber] = list;
  }

  return {
    persons, slots, events, snapshot, occupant,
    firstDay: congressStart(1), lastDay,
  };
}
