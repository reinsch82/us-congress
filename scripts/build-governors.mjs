// Builds data/governors.json: every governor of the 50 states, with dates and party.
// Run daily by .github/workflows/deploy.yml.
//
// Sources:
// - Wikidata (CC0): who held each state's governor office, with exact dates where recorded.
// - Jacob Kaplan's "United States Governors 1775-2020" (ODbL, from National Governors
//   Association data): years in office for governors that Wikidata lists without dates,
//   and party per year where Wikidata gives a governor several parties without dates.
// - Open States (CC0): today's governors. Every run records them in
//   data/governors-observed.json, so this site keeps its own day-by-day record of who
//   governs each state, and a new governor shows up before Wikidata catches up.
//
// The previous snapshot guards against losses: a term that disappears from the sources, or
// loses its exact dates, is kept from the previous snapshot for up to 60 days. Corrections
// (other dates, another party) are taken over right away.

import { writeFile, readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { STATE_NAMES, STATEHOOD, toDay, fromDay } from '../js/model.js';

const OUT = new URL('../data/governors.json', import.meta.url);
const OBSERVED = new URL('../data/governors-observed.json', import.meta.url);
const RETAIN_DAYS = 60;
const SPARQL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'us-congress-governors/1.0 (https://github.com/reinsch82/us-congress)';
const KAPLAN_CSV = 'https://raw.githubusercontent.com/jacobkap/governors/master/data/united_states_governors_1775_2020.csv';
const OPENSTATES = 'openstates/people';
const TODAY = toDay(new Date().toISOString().slice(0, 10));

const ghHeaders = { Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function sparql(query) {
  const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const json = await res.json();
  return json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

const qid = (uri) => uri?.replace('http://www.wikidata.org/entity/', '');

// ---------------------------------------------------------------- parties

function normaliseParty(label) {
  if (!label) return null;
  const l = label.toLowerCase();
  if (/democratic[-– ]republican|jeffersonian/.test(l)) return 'Democratic-Republican';
  if (/national republican/.test(l)) return 'National Republican';
  if (/farmer[-–]labor/.test(l) && !/democratic/.test(l)) return 'Farmer-Labor';
  if (/know[- ]nothing|^american( party)?$/.test(l)) return 'American';
  if (/people's|populist/.test(l)) return 'Populist';
  if (/alaskan independence/.test(l)) return 'Alaskan Independence';
  if (/independent|nonpartisan$|no party/.test(l)) return 'Independent';
  if (/whig/.test(l)) return 'Whig';
  if (/federalist/.test(l)) return 'Federalist';
  if (/progressive/.test(l)) return 'Progressive';
  if (/reform party/.test(l)) return 'Reform';
  if (/national union/.test(l)) return 'Republican';
  if (/jackson/.test(l)) return 'Democrat';
  if (/democrat/.test(l)) return 'Democrat';
  if (/republican/.test(l)) return 'Republican';
  return label.replace(/ [Pp]arty$/, '');
}

// Years a party existed, to pick between several undated party memberships.
const PARTY_YEARS = {
  Federalist: [1789, 1835], 'Democratic-Republican': [1792, 1834], 'National Republican': [1824, 1834],
  Whig: [1833, 1860], American: [1844, 1860], 'Free Soil': [1848, 1855], Democrat: [1828, 9999],
  Republican: [1854, 9999], Populist: [1891, 1910], Progressive: [1912, 1948],
};
const existedIn = (party, year) => {
  const span = PARTY_YEARS[party];
  return !span || (year >= span[0] && year <= span[1]);
};

// ---------------------------------------------------------------- names

const STATE_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([abbr, name]) => [name, abbr]));

function nameKey(name) {
  const tokens = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/["“”(].*?["”)]/g, ' ').replace(/[^a-z\s-]/g, ' ').split(/\s+/)
    .filter((t) => t && !['jr', 'sr', 'ii', 'iii', 'iv'].includes(t));
  return { first: tokens[0] || '', last: tokens[tokens.length - 1] || '', tokens };
}
// Same surname, and a first name that appears in the other name or shares its initial
// ("Marvin Griffin" is "Samuel Marvin Griffin" in the NGA data).
const sameName = (a, b) => a.last === b.last
  && (a.first[0] === b.first[0] || b.tokens.includes(a.first) || a.tokens.includes(b.first));

// ---------------------------------------------------------------- sources

async function loadWikidata() {
  const offices = await sparql(`
    SELECT ?code ?office WHERE {
      ?state wdt:P31 wd:Q35657 ; wdt:P300 ?code ; wdt:P1313 ?office .
    }`);
  const officeState = Object.fromEntries(offices.map((o) => [qid(o.office), o.code.replace('US-', '')]));
  if (Object.keys(officeState).length !== 50) throw new Error(`Found ${Object.keys(officeState).length} governor offices, expected 50`);
  const values = Object.keys(officeState).map((q) => `wd:${q}`).join(' ');

  const terms = await sparql(`
    SELECT ?office ?person ?personLabel ?start ?startPrec ?end ?endPrec ?nature ?image WHERE {
      VALUES ?office { ${values} }
      ?person wdt:P31 wd:Q5 ; p:P39 ?st . ?st ps:P39 ?office .
      MINUS { ?st wikibase:rank wikibase:DeprecatedRank }
      OPTIONAL { ?st pqv:P580 [ wikibase:timeValue ?start ; wikibase:timePrecision ?startPrec ] }
      OPTIONAL { ?st pqv:P582 [ wikibase:timeValue ?end ; wikibase:timePrecision ?endPrec ] }
      OPTIONAL { ?st pq:P5102 ?nature }
      OPTIONAL { ?person wdt:P18 ?image }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`);

  const parties = await sparql(`
    SELECT DISTINCT ?person ?partyLabel ?pstart ?pend ?rank WHERE {
      VALUES ?office { ${values} }
      ?person p:P39/ps:P39 ?office .
      ?person p:P102 ?ps . ?ps ps:P102 ?party ; wikibase:rank ?rank .
      FILTER(?rank != wikibase:DeprecatedRank)
      OPTIONAL { ?ps pq:P580 ?pstart }
      OPTIONAL { ?ps pq:P582 ?pend }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`);
  const partiesOf = new Map();
  for (const p of parties) {
    const list = partiesOf.get(qid(p.person)) || [];
    list.push({
      party: normaliseParty(p.partyLabel),
      s: p.pstart ? toDay(p.pstart.slice(0, 10)) : null,
      e: p.pend ? toDay(p.pend.slice(0, 10)) : null,
      preferred: p.rank.endsWith('PreferredRank'),
    });
    partiesOf.set(qid(p.person), list);
  }
  return { officeState, terms, partiesOf };
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function loadKaplan() {
  const res = await fetch(KAPLAN_CSV);
  if (!res.ok) throw new Error(`Kaplan CSV ${res.status}`);
  const [cols, ...records] = parseCsv(await res.text());
  const rows = records.map((r) => Object.fromEntries(r.map((v, i) => [cols[i], v])));
  // One entry per governor and stretch of service, with the years they appear in.
  const groups = new Map();
  for (const r of rows) {
    const state = STATE_BY_NAME[r.state];
    if (!state) continue;
    const id = `${state}|${r.governor}|${r.time_in_office}`;
    if (!groups.has(id)) groups.set(id, { state, name: r.governor, key: nameKey(r.governor), span: r.time_in_office, years: new Map() });
    groups.get(id).years.set(Number(r.year), normaliseParty(r.party));
  }
  for (const g of groups.values()) {
    const [a, b] = g.span.split(' - ').map(Number);
    const years = [...g.years.keys()];
    // A few spans have typos ("1873 - 1975"); fall back to the years listed.
    const sane = b >= a && b - a <= 12;
    g.startYear = sane ? a : Math.min(...years);
    g.endYear = sane ? b : Math.max(...years) + 1;
  }
  return [...groups.values()];
}

async function loadOpenStatesGovernors() {
  const res = await fetch(`https://api.github.com/repos/${OPENSTATES}/git/trees/main?recursive=1`, { headers: ghHeaders });
  if (!res.ok) throw new Error(`GitHub API ${res.status} listing ${OPENSTATES}`);
  const paths = (await res.json()).tree.map((t) => t.path).filter((p) => /^data\/[a-z]{2}\/executive\/.+\.yml$/.test(p));
  const governors = {};
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
  await Promise.all(paths.map(async (path) => {
    const r = await fetch(`https://raw.githubusercontent.com/${OPENSTATES}/main/${path}`);
    if (!r.ok) return;
    const person = yaml.load(await r.text());
    const role = person.roles?.find((x) => x.type === 'governor'
      && (!x.end_date || toDay(iso(x.end_date)) > TODAY) && (!x.start_date || toDay(iso(x.start_date)) <= TODAY));
    if (!role) return;
    governors[path.split('/')[1].toUpperCase()] = {
      id: person.id.replace('ocd-person/', ''),
      name: person.name,
      party: normaliseParty(person.party?.[0]?.name),
      start: role.start_date ? iso(role.start_date) : null,
      image: person.image || null,
    };
  }));
  return governors;
}

// ---------------------------------------------------------------- assembling

const dayOf = (iso) => toDay(iso.slice(0, 10).replace(/^\+/, ''));
const precisionOf = (p) => (Number(p) >= 11 ? 'day' : 'year');

function pickParty(candidates, term, kaplanParty) {
  const year = new Date(term.s * 864e5).getUTCFullYear();
  const valid = candidates.filter((c) => c.party);
  const dated = valid.filter((c) => c.s !== null && c.s <= term.s && (c.e === null || c.e > term.s));
  if (dated.length) return dated[0].party;
  const distinct = [...new Set(valid.map((c) => c.party))];
  if (distinct.length === 1) return distinct[0];
  if (kaplanParty && (!distinct.length || distinct.includes(kaplanParty))) return kaplanParty;
  const plausible = distinct.filter((p) => existedIn(p, year));
  if (plausible.length === 1) return plausible[0];
  return valid.find((c) => c.preferred)?.party || plausible[0] || distinct[0] || kaplanParty || null;
}

// Sort a state's terms and make them non-overlapping. Exact dates win over year-only
// ones: a year-only successor starts when its exactly dated predecessor left. A term
// inside another (an acting governor while the governor was incapacitated) interrupts it.
function resolve(terms) {
  terms.sort((a, b) => a.s - b.s || (a.e ?? Infinity) - (b.e ?? Infinity));
  const out = [];
  const queue = [...terms];
  while (queue.length) {
    const t = queue.shift();
    const last = out[out.length - 1];
    if (last && last.person === t.person && t.s <= (last.e ?? Infinity)) {
      last.e = Math.max(last.e ?? Infinity, t.e ?? Infinity);
      if (last.e === Infinity) last.e = null;
      continue;
    }
    const inside = last && t.e !== null && t.s > last.s && (last.e === null || t.e < last.e);
    if (inside && t.startPrecision === 'day' && last.startPrecision === 'day') {
      const rest = { ...last, s: t.e, startPrecision: 'day' };
      last.e = t.s;
      out.push(t);
      const at = queue.findIndex((q) => q.s >= rest.s);
      queue.splice(at === -1 ? queue.length : at, 0, rest);
      continue;
    }
    if (last && (last.e === null || last.e > t.s)) {
      if (t.startPrecision === 'year' && last.startPrecision === 'day' && last.e !== null && last.e < (t.e ?? Infinity)) {
        t.s = last.e;
      } else {
        last.e = t.s;
      }
    }
    if (last && last.e !== null && last.e <= last.s) out.pop();
    out.push(t);
  }
  return out;
}

const INDEPENDENCE = toDay('1776-01-01');
// Some states inaugurated their first governor a year or two before formal admission.
const firstStateDay = (state) => Math.max(INDEPENDENCE, STATEHOOD[state] - 3 * 365);

const { officeState, terms, partiesOf } = await loadWikidata();
const kaplan = await loadKaplan();
console.log(`Wikidata: ${terms.length} terms; Kaplan: ${kaplan.length} stretches of service`);

const byState = Object.fromEntries(Object.values(officeState).map((s) => [s, []]));
const people = new Map();
let filled = 0, unplaced = [];

for (const row of terms) {
  const state = officeState[qid(row.office)];
  const person = qid(row.person);
  if (!people.has(person)) {
    people.set(person, {
      name: row.personLabel,
      image: row.image ? decodeURIComponent(row.image.split('/Special:FilePath/')[1] || '') : null,
    });
  }
  const acting = qid(row.nature) === 'Q4676846';
  const key = nameKey(row.personLabel);
  const kaplanMatches = kaplan.filter((g) => g.state === state && sameName(g.key, key));
  const kaplanPartyIn = (year) => kaplanMatches.map((g) => g.years.get(year)).find(Boolean) || null;

  const spans = [];
  if (row.start) {
    spans.push({
      s: dayOf(row.start), startPrecision: precisionOf(row.startPrec),
      e: row.end ? dayOf(row.end) : null, endPrecision: row.end ? precisionOf(row.endPrec) : null,
    });
  } else if (kaplanMatches.length) {
    filled++;
    for (const g of kaplanMatches) {
      spans.push({ s: toDay(`${g.startYear}-01-01`), startPrecision: 'year', e: toDay(`${g.endYear}-01-01`), endPrecision: 'year' });
    }
  } else {
    unplaced.push(`${state} ${row.personLabel}`);
    continue;
  }
  for (const span of spans) {
    // The offices also list colonial, Spanish, royal and territorial governors.
    // Keep state governors only: from independence, or from shortly before admission.
    if (span.s < firstStateDay(state)) continue;
    const year = new Date(span.s * 864e5).getUTCFullYear();
    byState[state].push({
      person, ...span, acting,
      party: pickParty(partiesOf.get(person) || [], span, kaplanPartyIn(year)),
    });
  }
}

// Items without an English or multilingual label come back as their ID; try any language.
const unnamed = [...people].filter(([, p]) => /^Q\d+$/.test(p.name)).map(([id]) => id);
for (let i = 0; i < unnamed.length; i += 50) {
  const ids = unnamed.slice(i, i + 50).join('|');
  const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|sitelinks&sitefilter=enwiki&format=json`, { headers: { 'User-Agent': USER_AGENT } });
  const { entities } = await res.json();
  for (const [id, e] of Object.entries(entities)) {
    const label = e.labels?.en?.value || e.labels?.mul?.value || e.sitelinks?.enwiki?.title || Object.values(e.labels || {})[0]?.value;
    if (label) people.get(id).name = label;
  }
}

const yearOf = (day) => new Date(day * 864e5).getUTCFullYear();
const DAYS_PER_YEAR = 366;

// Wikidata sometimes has only some of a governor's terms. Fill each gap of more than four
// months with the NGA stretches (via Kaplan) that fall into it.
function fillGaps(state, list) {
  const stretches = kaplan.filter((g) => g.state === state);
  const bounds = [{ e: firstStateDay(state) }, ...list, { s: toDay(`${yearOf(TODAY) + 1}-01-01`) }];
  const added = [];
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1].e, to = bounds[i].s;
    if (from === null || from === undefined || to - from <= 120) continue;
    const inGap = stretches
      .filter((g) => g.startYear >= yearOf(from) && g.startYear < yearOf(to) && g.endYear <= yearOf(to) + 1)
      .filter((g) => !list.some((t) => sameName(nameKey(people.get(t.person).name), g.key) && yearOf(t.s) === g.startYear))
      .sort((a, b) => a.startYear - b.startYear);
    for (const g of inGap) {
      let s = Math.max(from, toDay(`${g.startYear}-01-01`));
      let e = Math.min(to, toDay(`${g.endYear}-01-01`));
      if (s - from < DAYS_PER_YEAR && g === inGap[0]) s = from;
      if (to - e < DAYS_PER_YEAR && g === inGap[inGap.length - 1]) e = to;
      if (e <= s) continue;
      // Match to the state's Wikidata governor by name, or by surname if only one has it
      // ("William P. Clements" in the NGA data is Wikidata's "Bill Clements").
      const statePeople = [...new Set(list.map((t) => t.person))].map((id) => [id, nameKey(people.get(id).name)]);
      const bySurname = statePeople.filter(([, k]) => k.last === g.key.last);
      const known = statePeople.find(([, k]) => sameName(k, g.key)) || (bySurname.length === 1 ? bySurname[0] : null);
      const person = known ? known[0] : `K:${g.name}`;
      if (!people.has(person)) people.set(person, { name: g.name, image: null });
      added.push({ person, s, e, startPrecision: 'year', endPrecision: 'year', acting: false, party: g.years.get(g.startYear) || null });
    }
  }
  return added;
}

// ---------------------------------------------------------------- own record of today's governors

// Each state's governors as seen in Open States, oldest first:
// { id, name, party, start (Open States' start date, if any), firstSeen, lastSeen }.
async function updateObservations(openStates) {
  const log = JSON.parse(await readFile(OBSERVED, 'utf8').catch(() => '{}'));
  const today = fromDay(TODAY);
  for (const [state, gov] of Object.entries(openStates)) {
    if (!STATEHOOD[state]) continue;
    const list = (log[state] ||= []);
    const last = list[list.length - 1];
    if (last && last.id === gov.id) {
      Object.assign(last, { name: gov.name, party: gov.party, start: gov.start ?? last.start, lastSeen: today });
    } else {
      list.push({ id: gov.id, name: gov.name, party: gov.party, start: gov.start, image: gov.image, firstSeen: today, lastSeen: today });
    }
  }
  const sorted = Object.fromEntries(Object.keys(log).sort().map((k) => [k, log[k]]));
  await writeFile(OBSERVED, `${JSON.stringify(sorted, null, 1)}\n`);
  return sorted;
}

const sameNameAs = (a, b) => sameName(nameKey(a), nameKey(b));

// Observed governors that the sources don't have yet become terms of their own. Their start
// is Open States' start date, or else the day this site first saw them.
function addObserved(state, list, log) {
  const observed = log[state] || [];
  const added = [];
  observed.forEach((o, i) => {
    const s = toDay(o.start || o.firstSeen);
    const next = observed[i + 1];
    const e = next ? toDay(next.start || next.firstSeen) : null;
    const known = list.some((t) => sameNameAs(people.get(t.person).name, o.name) && (t.e === null || t.e > s) && (e === null || t.s < e));
    if (known) return;
    const person = `OS:${o.id}`;
    if (!people.has(person)) people.set(person, { name: o.name, imageUrl: o.image || null });
    added.push({
      person, s, e, startPrecision: 'day', endPrecision: e === null ? null : 'day', acting: false, party: o.party,
      observed: o.start ? 'start-date' : 'first-seen',
    });
  });
  return added;
}

// ---------------------------------------------------------------- protection against losses

function fromSnapshot(t) {
  return {
    person: t.id, s: toDay(t.start), e: t.end ? toDay(t.end) : null,
    startPrecision: t.startPrecision || 'day', endPrecision: t.end ? (t.endPrecision || 'day') : null,
    party: t.party, acting: !!t.acting, observed: t.observed, retainedSince: t.retainedSince,
  };
}

// Keep what the previous snapshot knew and the new build lost, for up to RETAIN_DAYS.
function retainLosses(state, list, previous, notes) {
  const overlaps = (a, b) => a.s < (b.e ?? Infinity) && b.s < (a.e ?? Infinity);
  const samePerson = (a, b) => a.person === b.person || sameNameAs(people.get(a.person)?.name ?? '', people.get(b.person)?.name ?? '');
  const expired = (t) => t.retainedSince && TODAY - toDay(t.retainedSince) > RETAIN_DAYS;
  const kept = [];
  for (const old of (previous?.states?.[state] || []).map(fromSnapshot)) {
    if (!people.has(old.person)) people.set(old.person, previous.people[old.person] || { name: old.person });
    const match = list.find((t) => samePerson(t, old) && overlaps(t, old));
    const name = people.get(old.person).name;
    if (!match) {
      if (expired(old)) { notes.push(`${state}: accepted removal of ${name} (${fromDay(old.s)})`); continue; }
      kept.push({ ...old, retainedSince: old.retainedSince || fromDay(TODAY) });
      notes.push(`${state}: kept ${name} (${fromDay(old.s)}), missing from the sources`);
    } else if (old.startPrecision === 'day' && match.startPrecision === 'year' && !expired(old)) {
      Object.assign(match, { s: old.s, e: old.e, startPrecision: 'day', endPrecision: old.endPrecision, retainedSince: old.retainedSince || fromDay(TODAY) });
      notes.push(`${state}: kept exact dates for ${name}, the sources only have years now`);
    }
  }
  return kept;
}

// ---------------------------------------------------------------- assembling

const openStates = await loadOpenStatesGovernors();
console.log(`Open States lists governors for ${Object.keys(openStates).length} jurisdictions.`);
if (Object.keys(openStates).filter((s) => STATEHOOD[s]).length < 45) throw new Error('Open States lists fewer than 45 state governors');
const log = await updateObservations(openStates);
const previous = JSON.parse(await readFile(OUT, 'utf8').catch(() => 'null'));

const states = {};
const notes = [];
let gapFills = 0, observedAdds = 0;
for (const [state, list] of Object.entries(byState)) {
  let terms = resolve(list);
  const gaps = fillGaps(state, terms);
  gapFills += gaps.length;
  terms = resolve([...terms, ...gaps]);
  const observed = addObserved(state, terms, log);
  observedAdds += observed.length;
  terms = resolve([...terms, ...observed]);
  const kept = retainLosses(state, terms, previous, notes);
  terms = resolve([...terms, ...kept]);
  states[state] = terms.map((t) => ({
    id: t.person,
    start: fromDay(t.s),
    ...(t.startPrecision === 'year' ? { startPrecision: 'year' } : {}),
    end: t.e === null ? null : fromDay(t.e),
    ...(t.endPrecision === 'year' ? { endPrecision: 'year' } : {}),
    party: t.party,
    ...(t.acting ? { acting: true } : {}),
    ...(t.observed ? { observed: t.observed } : {}),
    ...(t.retainedSince ? { retainedSince: t.retainedSince } : {}),
  }));
}

console.log(`Added ${gapFills} terms missing from Wikidata from Kaplan, ${observedAdds} from this site's own record.`);
console.log(`Filled ${filled} undated Wikidata entries from Kaplan; ${unplaced.length} could not be placed.`);
if (unplaced.length) console.log(`Not placed: ${unplaced.join('; ')}`);
for (const n of notes) console.log(`::warning::${n}`);

// Every state needs exactly one governor today, the one Open States lists.
const problems = [];
const todayIso = fromDay(TODAY);
for (const [state, list] of Object.entries(states)) {
  const current = list.filter((t) => t.start <= todayIso && (t.end === null || t.end > todayIso));
  const expected = openStates[state];
  if (current.length !== 1) problems.push(`${state}: ${current.length} governors today`);
  else if (expected && !sameNameAs(people.get(current[0].id).name, expected.name)) {
    problems.push(`${state}: snapshot has ${people.get(current[0].id).name}, Open States has ${expected.name}`);
  }
}
if (problems.length) {
  console.error(`Not updating the snapshot:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const usedPeople = new Set(Object.values(states).flatMap((l) => l.map((t) => t.id)));
const json = JSON.stringify({
  sources: ['Wikidata (CC0)', 'Jacob Kaplan, United States Governors 1775-2020 (ODbL)', 'Open States (CC0)'],
  people: Object.fromEntries([...people].filter(([id]) => usedPeople.has(id))),
  states,
});
if (JSON.stringify(previous) === json) {
  console.log('Snapshot unchanged.');
} else {
  await writeFile(OUT, json);
  console.log(`Wrote ${usedPeople.size} governors (${(json.length / 1e6).toFixed(2)} MB).`);
}
