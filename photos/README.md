# Station photos

Drop one image per station here and add it to `station_official.json`:

    "26": { ..., "photo": { "file": "photos/station-26.jpg", "credit": "Photo: <who took it>" } }

then run `node apply_official.js` and bump the `data.js` / `app.js` `?v=` in `index.html`.

- 16:9, about 800x450, JPEG, under ~80 KB (31 photos should total only a couple of MB).
- A station with no `photo` entry shows the card exactly as before; a broken path just hides the photo.
- **Only add photos you have the right to publish.** portland.gov images are copyrighted by the City
  (reuse beyond fair use needs permission from City Archives & Records), so get written permission from
  PF&R, or use photos the class takes itself. Put the real credit in `credit`.
- This folder is deployed; this README is not (`firebase.json` ignores `*.md`).
