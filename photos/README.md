# Station photos

Each station card can show a photo at the top, with the address and cross streets below it.
A photo is set per station in `station_official.json`, either way:

**Linked from its source page (what the site uses now)**

    "1": { "photo": { "url": "https://www.portland.gov/.../station-1-exterior.jpg",
                      "credit": "Photo: Portland Fire & Rescue",
                      "page": "https://www.portland.gov/fire/station-1" }, ... }

Nothing is copied into this repo; visitors' browsers load the image from portland.gov and the credit
links back to `page`. The site's Content-Security-Policy (`firebase.json`) allows images from
`https://www.portland.gov` only. Linked photos need a connection (the offline copy won't have them;
the card just shows without a photo).

**Local file** (own photos, or ones you have permission to host): put a ~800x400 JPEG here and use
`"photo": { "file": "photos/station-26.jpg", "credit": "Photo: ..." }`.

## Filling in the rest

    python fetch_station_photos.py     # looks up each station page's image URL; skips stations that have one
    node apply_official.js             # rebuilds data.js

then bump the `data.js` `?v=` in `index.html`. Run it from a machine that can reach portland.gov, and
eyeball the printed list before committing: it takes each page's `og:image`, which should be the
exterior shot but is worth checking.

A station with no `photo` entry looks exactly as before, and a broken URL just hides the photo.
This README is not deployed (`firebase.json` ignores `*.md`).
