# Congress Seats Through Time

A static page that draws every seat in the US Senate and House of Representatives on any day from 1789 to today, with one dot per member, colored by party.

When the page loads, it downloads `legislators-historical.yaml` and `legislators-current.yaml` from the `main` branch of
[unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators), so it always shows the latest data.
There is no build step and no copy of the data in this repository. If the raw files can't be fetched, the page falls back to the JSON copies
on that project's GitHub Pages site. Member photos come from [unitedstates/images](https://github.com/unitedstates/images).

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

## Publishing on GitHub Pages

In the repository settings, under **Pages → Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.

## Files

- `js/model.js` turns person records into per-seat timelines and change events. It has no DOM code, so it also runs under Node.
- `js/parties.js` holds party name normalisation, colors and seating order.
- `js/app.js` handles loading, rendering (D3) and controls.

## Data caveats

Before about 1989, House records (and many early Senate records) give every member a full-Congress span, even members who left partway through.
When the successor's start date is recorded, the predecessor's service is cut off on that day. When it isn't, the seat shows one member and the
tooltip lists the others who held it during that Congress. Members recorded as starting when the first session convened are counted from the day the
Congress legally began. Before 1840, “Republican” in the data means the Jeffersonian Democratic-Republicans.
