# Finds each station's exterior photo on its portland.gov page and records the
# image URL (linked, not downloaded) in station_official.json. Run it from any
# machine that can reach portland.gov:
#
#     python fetch_station_photos.py            # fills in stations with no photo yet
#     python fetch_station_photos.py --force    # re-check every station
#     node apply_official.js                    # then rebuild data.js
#
# Standard library only. It prints what it found for every station so you can
# eyeball the list; a station it can't find an image for is left alone.
import html
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "station_official.json")
PAGE = "https://www.portland.gov/fire/station-{n}"
CREDIT = "Photo: Portland Fire & Rescue"


def find_image(page_html):
    """Best image URL on a station page, or None. Prefers the page's og:image,
    then any portland.gov styled image whose name mentions 'exterior'."""
    for pat in (
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
    ):
        m = re.search(pat, page_html, re.I)
        if m:
            return absolute(html.unescape(m.group(1)))
    found = re.findall(r'(?:https?://www\.portland\.gov)?/sites/default/files/[^"\'\s>)]+\.(?:jpg|jpeg|png)[^"\'\s>)]*', page_html, re.I)
    found = [absolute(html.unescape(u)) for u in found]
    for u in found:
        if "exterior" in u.lower():
            return u
    return found[0] if found else None


def absolute(u):
    return u if u.startswith("http") else "https://www.portland.gov" + u


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (station-photo-finder; study project)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def dump(data):
    # Same one-station-per-line layout the file is hand-maintained in.
    keys = [k for k in data if not k.startswith("_")]
    keys.sort(key=int)
    lines = ["{"]
    if "_source" in data:
        lines.append(f'  "_source": {json.dumps(data["_source"], ensure_ascii=False)},')
    for i, k in enumerate(keys):
        lines.append(f'  {json.dumps(k)}: {json.dumps(data[k], ensure_ascii=False)}' + ("," if i < len(keys) - 1 else ""))
    lines.append("}")
    return "\n".join(lines) + "\n"


def main():
    force = "--force" in sys.argv
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)
    changed = 0
    for k in sorted((k for k in data if not k.startswith("_")), key=int):
        if data[k].get("photo") and not force:
            print(f"station {k:>2}: already has a photo, skipped")
            continue
        page = PAGE.format(n=k)
        try:
            img = find_image(fetch(page))
        except Exception as e:  # network error, 404, ...
            print(f"station {k:>2}: could not read {page} ({e})")
            continue
        if not img:
            print(f"station {k:>2}: no image found on the page")
            continue
        photo = {"url": img, "credit": CREDIT, "page": page}
        # Keep the photo key first so the diff stays readable.
        data[k] = {"photo": photo, **{kk: vv for kk, vv in data[k].items() if kk != "photo"}}
        changed += 1
        print(f"station {k:>2}: {img}")
        time.sleep(1)  # be polite to the City's server
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(dump(data))
    print(f"\n{changed} station(s) updated. Now run: node apply_official.js")


if __name__ == "__main__":
    main()
