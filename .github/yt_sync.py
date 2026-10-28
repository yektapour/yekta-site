"""Keeps yt/videos.json and yt/thumbs/ in step with the YouTube channel. Runs on GitHub every hour.
New uploads are added (newest first), videos removed from the channel feed stay listed unless they are gone from YouTube."""
import json, os, re, sys, urllib.request, xml.etree.ElementTree as ET
HANDLE = 'yektapour'
OUT = 'yt'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; yektapour-site-sync)', 'Accept-Language': 'en'}
def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    return data if binary else data.decode('utf8', 'replace')
os.makedirs(f'{OUT}/thumbs', exist_ok=True)
path = f'{OUT}/videos.json'
try: db = json.load(open(path))
except Exception: db = {}
cid = db.get('channel')
if not cid:
    page = get(f'https://www.youtube.com/@{HANDLE}')
    m = re.search(r'"(?:channelId|externalId)":"(UC[\w-]{22})"', page) or re.search(r'channel/(UC[\w-]{22})', page)
    if not m: print('channel id not found'); sys.exit(1)
    cid = m.group(1)
ns = {'a': 'http://www.w3.org/2005/Atom', 'yt': 'http://www.youtube.com/xml/schemas/2015', 'media': 'http://search.yahoo.com/mrss/'}
feed = ET.fromstring(get(f'https://www.youtube.com/feeds/videos.xml?channel_id={cid}'))
items = {v['id']: v for v in db.get('items', [])}
for e in feed.findall('a:entry', ns):
    vid = e.find('yt:videoId', ns).text
    link = e.find('a:link', ns).get('href', '')
    items[vid] = {'id': vid, 'title': e.find('a:title', ns).text or '', 'published': e.find('a:published', ns).text,
                  'short': '/shorts/' in link or items.get(vid, {}).get('short', False)}
# shorts are not always marked in the feed: ask YouTube once per new video
for v in items.values():
    if 'checked' in v: continue
    try:
        req = urllib.request.Request(f'https://www.youtube.com/shorts/{v["id"]}', headers=UA, method='HEAD')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k): return None
        op = urllib.request.build_opener(NoRedirect)
        try: r = op.open(req, timeout=20); v['short'] = r.status == 200
        except urllib.error.HTTPError as e: v['short'] = False if e.code in (301, 302, 303) else v['short']
    except Exception: pass
    v['checked'] = 1
# thumbnails, stored on the site so they load fast (and everywhere)
for v in items.values():
    f = f'{OUT}/thumbs/{v["id"]}.jpg'
    if os.path.exists(f): continue
    for name in (['oardefault'] if v['short'] else []) + ['maxresdefault', 'sddefault', 'hqdefault']:
        try:
            b = get(f'https://i.ytimg.com/vi/{v["id"]}/{name}.jpg', binary=True)
            if len(b) > 2000: open(f, 'wb').write(b); break
        except Exception: continue
out = sorted(items.values(), key=lambda v: v['published'], reverse=True)
new = {'channel': cid, 'items': out}
old = json.dumps(db, sort_keys=True); now = json.dumps(new, sort_keys=True)
if old != now:
    json.dump(new, open(path, 'w'), indent=1)
    print('updated', len(out), 'videos')
else:
    print('no change')
