// Builds data/legislators.json: a trimmed snapshot of the congress-legislators YAML with
// only the fields the page uses. Run daily by .github/workflows/deploy.yml.
//
// The snapshot records which upstream commit each file came from, so the page can tell
// whether GitHub has newer data. Nothing is written if the data fails the sanity checks.

import { writeFile, readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { buildModel, toDay } from '../js/model.js';

const REPO = 'unitedstates/congress-legislators';
const FILES = ['legislators-historical', 'legislators-current'];
const OUT = new URL('../data/legislators.json', import.meta.url);

const apiHeaders = { Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) apiHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function latestCommit(file) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=main&path=${file}.yaml&per_page=1`, { headers: apiHeaders });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${file}`);
  const [commit] = await res.json();
  return { sha: commit.sha, date: commit.commit.committer.date };
}

async function fetchYaml(file, sha) {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${file}.yaml`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}.yaml@${sha}`);
  return yaml.load(await res.text());
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

function trim(person) {
  return {
    id: { bioguide: person.id.bioguide },
    name: pick(person.name, ['first', 'nickname', 'last', 'suffix', 'official_full']),
    terms: person.terms.map((t) => pick(t, ['type', 'start', 'end', 'state', 'district', 'class', 'party', 'party_affiliations', 'caucus', 'how'])),
  };
}

// Today's chambers must look like Congress: the right number of seats, mostly filled.
function check(people) {
  const model = buildModel(people, toDay(new Date().toISOString().slice(0, 10)));
  const problems = [];
  for (const [chamber, seats, minFilled] of [['sen', 100, 90], ['rep', 435, 400]]) {
    const entries = model.snapshot(chamber, model.lastDay);
    const filled = entries.filter((e) => e.occ).length;
    console.log(`${chamber}: ${entries.length} seats, ${filled} filled`);
    if (entries.length !== seats) problems.push(`${chamber} has ${entries.length} seats, expected ${seats}`);
    if (filled < minFilled) problems.push(`${chamber} has only ${filled} members`);
  }
  return problems;
}

const sources = {};
const people = [];
for (const file of FILES) {
  sources[file] = await latestCommit(file);
  people.push(...(await fetchYaml(file, sources[file].sha)).map(trim));
}

const problems = check(people);
if (problems.length) {
  console.error(`Not updating the snapshot:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const json = JSON.stringify({ repo: REPO, sources, people });
const previous = await readFile(OUT, 'utf8').catch(() => '');
if (previous === json) {
  console.log('Snapshot unchanged.');
} else {
  await writeFile(OUT, json);
  console.log(`Wrote ${people.length} legislators (${(json.length / 1e6).toFixed(1)} MB).`);
}
