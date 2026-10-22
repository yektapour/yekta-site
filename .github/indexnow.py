"""After each GitHub Pages deploy: tell IndexNow (Bing, Yandex, Seznam, Naver...) which pages changed.
A page counts as changed when its lastmod in sitemap.xml differs from the previous deploy, or it is new."""
import json, os, re, subprocess, sys, urllib.request
HOST = 'yektapour.com'
KEY = '9e9f53dd8a9b164e8a30ace3204520c3'
def urls(xml):
    return dict(re.findall(r'<url><loc>([^<]+)</loc><lastmod>([^<]+)</lastmod>', xml))
now = urls(open('sitemap.xml', encoding='utf8').read())
if os.environ.get('ALL') == '1':
    changed = list(now)
else:
    try:
        old = urls(subprocess.run(['git', 'show', 'HEAD~1:sitemap.xml'], capture_output=True, text=True, check=True).stdout)
    except Exception:
        old = {}
    changed = [u for u, d in now.items() if old.get(u) != d]
    gone = [u for u in old if u not in now]
    changed += gone
if not changed:
    print('nothing changed'); sys.exit(0)
body = json.dumps({'host': HOST, 'key': KEY, 'keyLocation': f'https://{HOST}/{KEY}.txt', 'urlList': changed[:10000]}).encode()
req = urllib.request.Request('https://api.indexnow.org/indexnow', data=body, headers={'Content-Type': 'application/json; charset=utf-8'})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print('IndexNow', r.status, len(changed), 'urls'); print('\n'.join(changed))
except urllib.error.HTTPError as e:
    print('IndexNow error', e.code, e.read()[:300]); sys.exit(1)
