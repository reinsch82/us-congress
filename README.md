# Congress Seats Through Time

**Live site: https://reinsch82.github.io/us-congress/** (Congress) and **https://reinsch82.github.io/us-congress/governors.html** (governors)

A static page that draws every seat in the US Senate and House of Representatives on any day from 1789 to today, with one dot per member, colored by party.

The data comes from `legislators-historical.yaml` and `legislators-current.yaml` on the `main` branch of
[unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators). A daily GitHub Actions job saves a trimmed snapshot
of it as `data/legislators.json` and deploys it with the page, so visitors only download about 450 KB from this site.

- On load, the page asks the GitHub API which upstream commit each file is at. If the snapshot is older, a link at the top loads the live data.
- If the snapshot can't be loaded, the page fetches the raw YAML from GitHub directly, or failing that the JSON copies on the project's GitHub Pages site.

Member photos come from [unitedstates/images](https://github.com/unitedstates/images).

## Governors page

`governors.html` shows every state's governor on a tile map, with the same date controls, a party-share timeline and a list of all
governors per state. Its data, `data/governors.json`, is built daily by `scripts/build-governors.mjs` from:

- [Wikidata](https://www.wikidata.org/) (CC0): who held each state's governor office, with exact dates where recorded.
- Jacob Kaplan's [United States Governors 1775–2020](https://github.com/jacobkap/governors) (ODbL, from National Governors Association data):
  years in office where Wikidata has no dates or misses a term, and party per year for governors with several parties.
  Terms from this source only have a year and are marked “year only”.
- [Open States](https://github.com/openstates/people) (CC0): today's governors. Every run records them in
  `data/governors-observed.json` (who, party, Open States' start date, first and last day seen). That gives this site its own
  day-by-day record, and a new governor appears on the page before Wikidata has them.

The build also compares with the previous snapshot. If a term disappears from the sources or loses its exact dates, the
previous version is kept for up to 60 days and the workflow logs a warning. After that the change is accepted, so genuine
corrections still come through. After changing the build logic itself, run it once with `NO_RETAIN=1`, so the
protection doesn't keep the old results. The snapshot is only written if every state has exactly one governor today, the one Open States lists.

Because part of it comes from Kaplan's dataset, `data/governors.json` is available under the
[ODbL](https://opendatacommons.org/licenses/odbl/1-0/). A few gaps remain where neither source has a governor; corrections made in
Wikidata appear on the page the next day.

## Features

- Hemicycle charts for both chambers. Seats glide to their new place when control of a seat changes.
- A date slider, a date picker, and step buttons for the previous/next Senate change, House change, any change, or Congress.
- Play mode, which walks through every change in order.
- A timeline of each party's share of seats, with the 50% line. Click or drag on it to jump to a date.
- For the current change, a list of who succeeded whom, net party gains and losses, and rings around the new members.
- Tooltips with photo, party, seat and dates of service. Click a seat to open the member's Bioguide page.
- An optional row of non-voting delegates and a table of every member on the chosen date.
- The URL keeps the selected date (`#1861-03-04`), so links are shareable.

## Running locally

ES modules need an HTTP server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To refresh the snapshot by hand:

```sh
npm ci
npm run build-data
```

The script checks that the data looks sane today (100 Senate seats, 435 House seats, nearly all of them filled) and leaves the snapshot alone if it doesn't.

## Deployment

`.github/workflows/deploy.yml` runs every day at 06:17 UTC, on every push to `main`, and on demand (**Actions → Update data and deploy → Run workflow**).
It rebuilds the snapshot and commits it only when the upstream data changed, then deploys the site to GitHub Pages.
If the new data fails the checks, the run deploys the previous snapshot and is marked as failed.

Before deploying, `scripts/stamp-build.sh` adds the commit ID to the script and stylesheet URLs and to the page itself. That way a browser never
mixes files from two deploys. GitHub Pages lets browsers cache each file for 10 minutes, and if the page is still an older version,
the script reloads it once.

GitHub Pages must use **GitHub Actions** as its source (**Settings → Pages → Build and deployment**).
GitHub turns off scheduled workflows in public repositories after 60 days without activity. The upstream files have gone longer than that
without changes (124 days in 2023), so after 45 days without a commit the workflow pushes an empty keep-alive commit.

## Files

- `js/model.js` turns person records into per-seat timelines and change events. It has no DOM code, so it also runs under Node.
- `js/parties.js` holds party name normalisation, colors and seating order.
- `js/app.js` handles loading, rendering (D3) and controls.
- `scripts/build-data.mjs` builds the daily legislator snapshot, `scripts/build-governors.mjs` the governor snapshot.
- `js/governors.js` runs the governors page, `js/common.js` holds helpers both pages share.

## Data caveats

Before about 1989, House records (and many early Senate records) give every member a full-Congress span, even members who left partway through.
When the successor's start date is recorded, the predecessor's service is cut off on that day. When it isn't, the seat shows one member and the
tooltip lists the others who held it during that Congress. Members recorded as starting when the first session convened are counted from the day the
Congress legally began. Before 1840, “Republican” in the data means the Jeffersonian Democratic-Republicans.

## License

The code is released under the [MIT License](LICENSE). The legislator data and photos belong to their respective projects and are not covered by it.
