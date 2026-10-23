#!/usr/bin/env python3
"""押し入れゲーム棚(このリポジトリ)の道具。build / new / check は標準ライブラリだけで動きます。

リポジトリの一番上で:
  python3 tools/shelf.py build             トップページ、各ゲームの manifest と sw.js、README のゲーム一覧を作り直す
  python3 tools/shelf.py build --base URL  共有画像などを絶対URLにする(shelf.json の base_url に書いておけば省略できる)
  python3 tools/shelf.py new ID タイトル    新しいゲームの下書きフォルダを作る(status が draft の間はトップページに出ない)
  python3 tools/shelf.py check             決まりごとを守れているか確かめる
  python3 tools/shelf.py images [ID ...]   アイコンPNGと共有画像を描き出す(Playwright が必要。ID を省くとトップページの分)
"""
import argparse, base64, datetime, html, json, math, re, struct, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TPL = Path(__file__).resolve().parent / 'templates'
RESERVED = {'tools', 'docs', 'assets', 'shared', 'node_modules'}
ID_RE = re.compile(r'^[a-z][a-z0-9-]{1,30}$')
COVER_RATIO = (1200, 630)  # 箱の表紙(cover)はこの比率で切り抜いて並べる
GENERATED = '<!-- このファイルは tools/shelf.py build が作ります。直接編集せず、tools/templates/portal.html・shelf.json・各ゲームの game.json を直してください -->'


def esc(s):
    return html.escape(str(s or ''), quote=True)


def rel(p):
    return p.relative_to(ROOT).as_posix()


def read_json(p):
    try:
        return json.loads(p.read_text('utf-8'))
    except json.JSONDecodeError as e:
        sys.exit(f'{rel(p)} の JSON が読めません: {e}')


def write_if_changed(p, text):
    old = p.read_text('utf-8') if p.exists() else None
    if old != text:
        p.write_text(text, 'utf-8')
        return True
    return False


def load_cfg():
    p = ROOT / 'shelf.json'
    if not p.exists():
        sys.exit('shelf.json が見つかりません。リポジトリの一番上で実行してください')
    cfg = read_json(p)
    cfg.setdefault('name', 'ゲーム置き場')
    cfg.setdefault('lang', 'ja')
    return cfg


def load_games():
    games = []
    for d in sorted(ROOT.iterdir()):
        if not d.is_dir() or d.name.startswith(('.', '_')) or d.name in RESERVED:
            continue
        f = d / 'game.json'
        if f.exists():
            g = read_json(f)
            g['_dir'] = d
            games.append(g)
    return games


def day_num(s):
    try:
        return datetime.date.fromisoformat(str(s)).toordinal()
    except ValueError:
        return 0


def public_sorted(games):
    pub = [g for g in games if g.get('status') == 'public']
    return sorted(pub, key=lambda g: (g.get('order', 100), -day_num(g.get('added')), g['id']))


def lum(c):
    h = c.lstrip('#')
    if len(h) == 3:
        h = ''.join(x * 2 for x in h)
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (f(v) for v in ch)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


def ink_on(bg):
    return '#ffffff' if contrast(bg, '#ffffff') >= contrast(bg, '#1d1a16') else '#1d1a16'


def png_size(p):
    try:
        with open(p, 'rb') as f:
            head = f.read(24)
        if head[:8] == b'\x89PNG\r\n\x1a\n':
            return struct.unpack('>II', head[16:24])
    except OSError:
        pass
    return None


# ---------------------------------------------------------------- check

def check_game(g):
    errs, warns = [], []
    d = g['_dir']
    name = d.name
    for k in ('id', 'title', 'status', 'version'):
        if not g.get(k):
            errs.append(f'{name}/game.json に "{k}" がありません')
    if g.get('id') and g['id'] != name:
        errs.append(f'{name}/game.json の id ("{g["id"]}") がフォルダ名と違います')
    if not ID_RE.match(name):
        errs.append(f'フォルダ名 {name} は英小文字で始まる英小文字・数字・ハイフン(2〜31文字)にしてください')
    if g.get('status') not in ('public', 'draft'):
        errs.append(f'{name}/game.json の status は "public" か "draft" にしてください')
    for k in ('theme_color', 'background_color', 'obi_color'):
        if g.get(k) and not re.fullmatch(r'#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?', g[k]):
            errs.append(f'{name}/game.json の {k} は #rrggbb の形にしてください')
    page = d / 'index.html'
    if not page.exists():
        errs.append(f'{name}/index.html がありません')
        return errs, warns
    src = page.read_text('utf-8')
    if g.get('status') == 'public':
        for k in ('catch', 'description', 'genre'):
            if not g.get(k):
                warns.append(f'{name}: トップページに出す "{k}" が空です')
        cover = d / g.get('cover', g.get('og_image', 'og.png'))
        if not cover.exists():
            warns.append(f'{name}: 箱の表紙 {rel(cover)} がありません(1200×630 の画像を推奨)')
        else:
            sz = png_size(cover)
            if sz and abs(sz[0] / sz[1] - COVER_RATIO[0] / COVER_RATIO[1]) > 0.02:
                warns.append(f'{name}: 表紙 {rel(cover)} は {sz[0]}×{sz[1]}。1200×630 の比率でないと上下か左右が切れます')
    for icon in ('icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'):
        if not (d / icon).exists():
            warns.append(f'{name}: {icon} がありません(python3 tools/shelf.py images {name} で作れます)')
    if g.get('offline', True) and 'serviceWorker' not in src:
        warns.append(f'{name}: index.html が sw.js を登録していません(オフラインで遊べない)')
    if 'manifest.webmanifest' not in src:
        warns.append(f'{name}: index.html に <link rel="manifest" href="manifest.webmanifest"> がありません')
    if 'shelf:' not in src:
        warns.append(f'{name}: トップページ用の記録(localStorage の shelf:{name})を書いていません')
    for key in re.findall(r"localStorage\.setItem\(\s*'([^']+)'", src):
        if not (key.startswith(name + '-') or key.startswith('shelf:')):
            warns.append(f'{name}: 保存キー "{key}" が "{name}-" で始まっていません(ほかのゲームとぶつかるかもしれません)')
    return errs, warns


def run_checks(games, quiet=False):
    errs, warns = [], []
    ids = set()
    for g in games:
        e, w = check_game(g)
        errs += e
        warns += w
        if g.get('id') in ids:
            errs.append(f'id "{g["id"]}" が重複しています')
        ids.add(g.get('id'))
    if not quiet or errs or warns:
        for m in errs:
            print('  × ' + m)
        for m in warns:
            print('  ! ' + m)
    return errs, warns


# ---------------------------------------------------------------- per game files

def write_manifest(g, cfg):
    d = g['_dir']
    icons = []
    for f, size, purpose in (('icon-192.png', '192x192', None), ('icon-512.png', '512x512', None),
                             ('icon-maskable-512.png', '512x512', 'maskable'), ('icon.svg', 'any', None)):
        if (d / f).exists():
            ic = {'src': f, 'sizes': size, 'type': 'image/svg+xml' if f.endswith('.svg') else 'image/png'}
            if purpose:
                ic['purpose'] = purpose
            icons.append(ic)
    m = {
        'name': g['title'], 'short_name': g.get('short_name', g['title']),
        'description': g.get('description', ''), 'lang': cfg['lang'],
        'start_url': './', 'scope': './', 'display': 'standalone',
        'orientation': g.get('orientation', 'any'),
        'background_color': g.get('background_color', '#ffffff'),
        'theme_color': g.get('theme_color', '#333333'), 'icons': icons}
    return write_if_changed(d / 'manifest.webmanifest', json.dumps(m, ensure_ascii=False, indent=2) + '\n')


SW = """// {title} のオフライン用キャッシュ(tools/shelf.py build が作成。直接編集しない)
// ゲームのページ: ネット優先(つながっていれば常に最新)。ほかのファイルとフォント: キャッシュを先に返して裏で更新
const PREFIX='{id}-';
const CACHE=PREFIX+'v{version}';
const HOME=new URL('./',self.location).pathname;
const CORE={core};
self.addEventListener('install',e=>{{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));}});
// 同じドメインに並ぶほかのゲームのキャッシュは消さない(自分の PREFIX の古い版だけ片付ける)
self.addEventListener('activate',e=>{{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));}});
self.addEventListener('fetch',e=>{{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(r.mode==='navigate'){{
    const page=u.pathname===HOME||u.pathname===HOME+'index.html';
    e.respondWith(fetch(r).then(res=>{{if(page&&res.ok){{const cp=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp));}}return res;}}).catch(()=>caches.match('./index.html')));
    return;
  }}
  const fontHost=u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
  if(u.origin!==location.origin&&!fontHost)return;
  e.respondWith(caches.match(r).then(hit=>{{
    const net=fetch(r).then(res=>{{if(res&&(res.ok||res.type==='opaque')){{const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));}}return res;}}).catch(()=>hit);
    return hit||net;
  }}));
}});
"""


def write_sw(g):
    d = g['_dir']
    core = ['./', './index.html']
    for f in ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'] + list(g.get('precache', [])):
        if (d / f).exists():
            core.append('./' + f)
        elif f in g.get('precache', []):
            print(f'  ! {d.name}: precache の {f} がないので外しました')
    js = SW.format(title=g['title'], id=g['id'], version=g['version'], core=json.dumps(core, ensure_ascii=False))
    return write_if_changed(d / 'sw.js', js)


def patch_meta(g, base):
    """Share-card URLs: absolute when the public address is known, relative otherwise."""
    d = g['_dir']
    page = d / 'index.html'
    src = page.read_text('utf-8')
    og = g.get('og_image', 'og.png')
    img = f'{base}{g["id"]}/{og}' if base else og
    out = re.sub(r'(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")', lambda m: m.group(1) + esc(img) + m.group(2), src)
    out = re.sub(r'\n?<meta property="og:url" content="[^"]*">', '', out)
    if base:
        out = re.sub(r'(<meta property="og:image" content="[^"]*">)', lambda m: m.group(1) + f'\n<meta property="og:url" content="{esc(base + g["id"] + "/")}">', out, count=1)
    return write_if_changed(page, out)


# ---------------------------------------------------------------- portal

def card(g, i):
    gid = g['id']
    d = g['_dir']
    color = g.get('obi_color') or g.get('theme_color', '#3b3b3b')
    kana = g.get('kana', '')
    n = max(len(g['title']), math.ceil(len(kana) / 2), 3)
    title = f'<ruby>{esc(g["title"])}<rt>{esc(kana)}</rt></ruby>' if kana else esc(g['title'])
    cover = g.get('cover', g.get('og_image', 'og.png'))
    w, h = png_size(d / cover) or COVER_RATIO
    lazy = ' loading="lazy"' if i > 1 else ''
    spec = ''.join(f'<div><dt>{k}</dt><dd>{esc(g[f])}</dd></div>' for k, f in (('ジャンル', 'genre'), ('1回の長さ', 'playtime'), ('操作', 'controls')) if g.get(f))
    catch = f'\n      <p class="catch">{esc(g["catch"])}</p>' if g.get('catch') else ''
    desc = f'\n      <p class="desc">{esc(g["description"])}</p>' if g.get('description') else ''
    spec = f'\n      <dl class="spec">{spec}</dl>' if spec else ''
    return f'''<li class="game" style="--obi:{color};--obi-ink:{ink_on(color)};--n:{n}">
  <article aria-labelledby="t-{gid}">
    <div class="box">
      <h2 class="obi" id="t-{gid}">{title}</h2>
      <a class="cover" href="{gid}/" tabindex="-1" aria-hidden="true"><img src="{gid}/{esc(cover)}" alt="" width="{w}" height="{h}"{lazy} decoding="async"></a>
    </div>
    <div class="tag">{catch}{desc}{spec}
      <div class="go"><a class="play" href="{gid}/">遊ぶ<span class="vh">({esc(g["title"])})</span></a><p class="rec" data-rec="{gid}" hidden></p></div>
    </div>
  </article>
</li>'''


def write_portal(cfg, pub, base):
    tpl = (TPL / 'portal.html').read_text('utf-8')
    games = '\n'.join(card(g, i + 1) for i, g in enumerate(pub))
    nxt = ''
    if cfg.get('next_slot'):
        nxt = f'<li class="game next">\n  <div class="box"><p class="empty">{esc(cfg["next_slot"])}</p></div>\n</li>'
    repo = f'<p><a href="{esc(cfg["repo_url"])}">ソースコード(GitHub)</a></p>' if cfg.get('repo_url') else ''
    rep = {
        'generated': GENERATED, 'lang': esc(cfg['lang']), 'name': esc(cfg['name']),
        'tagline': esc(cfg.get('tagline', '')), 'description': esc(cfg.get('description', cfg.get('tagline', ''))),
        'og_image': esc(base + 'og.png' if base else 'og.png'),
        'og_url': f'<meta property="og:url" content="{esc(base)}">' if base else '',
        'games': games, 'next': nxt, 'repo': repo, 'count': str(len(pub)),
    }
    out = re.sub(r'\{\{(\w+)\}\}', lambda m: rep[m.group(1)], tpl)
    out = re.sub(r'\n[ \t]*\n', '\n', out)
    return write_if_changed(ROOT / 'index.html', out)


def write_readme_list(cfg, pub, base):
    p = ROOT / 'README.md'
    if not p.exists():
        return False
    src = p.read_text('utf-8')
    start, end = '<!-- shelf:games -->', '<!-- /shelf:games -->'
    if start not in src or end not in src:
        print('  ! README.md にゲーム一覧の目印(<!-- shelf:games --> と <!-- /shelf:games -->)がないので、一覧は更新しませんでした')
        return False
    rows = ['| ゲーム | ジャンル | 1回の長さ | 遊ぶ |', '| --- | --- | --- | --- |']
    for g in pub:
        play = f'[遊ぶ]({base}{g["id"]}/)' if base else '公開後にURLが入ります'
        kana = f'（{g["kana"]}）' if g.get('kana') else ''
        about = f'<br>[説明]({g["id"]}/README.md)' if (g['_dir'] / 'README.md').exists() else ''
        rows.append(f'| **{g["title"]}**{kana}<br>{g.get("catch", "")} | {g.get("genre", "")} | {g.get("playtime", "")} | {play}{about} |')
    if not pub:
        rows.append('| (まだありません) | | | |')
    block = start + '\n' + '\n'.join(rows) + '\n' + end
    out = src[:src.index(start)] + block + src[src.index(end) + len(end):]
    us, ue = '<!-- shelf:url -->', '<!-- /shelf:url -->'
    if us in out and ue in out:
        if base:
            ex = f'(例: [{pub[0]["title"]}]({base}{pub[0]["id"]}/))' if pub else ''
            lines = f'- トップページ: {base}\n- 各ゲーム: `{base}<ゲームのフォルダ名>/` {ex}'.rstrip()
        else:
            lines = '- 公開URL: GitHub Pages か Cloudflare Pages で公開すると、トップページはリポジトリの一番上、各ゲームは `<公開URL>/<ゲームのフォルダ名>/` で開けます'
        out = out[:out.index(us)] + us + '\n' + lines + '\n' + ue + out[out.index(ue) + len(ue):]
    return write_if_changed(p, out)


HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/
  Cache-Control: no-cache
/:game/
  Cache-Control: no-cache
/:game/sw.js
  Cache-Control: no-cache
"""


def cmd_build(base_arg):
    cfg = load_cfg()
    base = cfg.get('base_url', '') if base_arg is None else base_arg
    base = base.rstrip('/') + '/' if base else ''
    games = load_games()
    errs, _ = run_checks(games)
    if errs:
        sys.exit('直すところがあるので作り直しを止めました')
    changed = []
    for g in games:
        if write_manifest(g, cfg):
            changed.append(rel(g['_dir'] / 'manifest.webmanifest'))
        if g.get('offline', True) and write_sw(g):
            changed.append(rel(g['_dir'] / 'sw.js'))
        if patch_meta(g, base):
            changed.append(rel(g['_dir'] / 'index.html'))
    pub = public_sorted(games)
    if write_portal(cfg, pub, base):
        changed.append('index.html')
    if write_readme_list(cfg, pub, base):
        changed.append('README.md')
    if not (ROOT / '_headers').exists():
        (ROOT / '_headers').write_text(HEADERS, 'utf-8')
        changed.append('_headers')
    if not (ROOT / '.nojekyll').exists():
        (ROOT / '.nojekyll').write_text('', 'utf-8')
        changed.append('.nojekyll')
    drafts = [g['id'] for g in games if g.get('status') == 'draft']
    print(f'並んでいるゲーム: {", ".join(g["title"] for g in pub) or "なし"}' + (f' / 下書き: {", ".join(drafts)}' if drafts else ''))
    print('公開URL: ' + (base or '(未設定。shelf.json の base_url に書くと共有画像が絶対URLになります)'))
    print('更新したファイル: ' + (', '.join(changed) if changed else 'なし'))


# ---------------------------------------------------------------- new

def placeholder_icon(title, color):
    ch = esc(title[:1] or '?')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="{color}"/>
  <text x="256" y="256" dy=".35em" text-anchor="middle" font-size="300" font-family="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif" fill="{ink_on(color)}">{ch}</text>
</svg>
'''


def cmd_new(gid, title):
    if not ID_RE.match(gid) or gid in RESERVED:
        sys.exit('ID は英小文字で始まる英小文字・数字・ハイフン(2〜31文字)にしてください。tools や docs などは使えません')
    d = ROOT / gid
    if d.exists():
        sys.exit(f'{gid}/ はもうあります')
    color = '#3d7a5c'
    g = {
        'id': gid, 'title': title, 'kana': '', 'catch': '', 'description': '',
        'genre': '', 'playtime': '', 'controls': '',
        'status': 'draft', 'version': '0.1.0', 'added': datetime.date.today().isoformat(),
        'theme_color': color, 'background_color': '#f4f6fb', 'orientation': 'any',
        'og_image': 'og.png', 'cover': 'og.png', 'offline': True}
    d.mkdir()
    (d / 'game.json').write_text(json.dumps(g, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    page = (TPL / 'new-game.html').read_text('utf-8')
    page = page.replace('{{id}}', gid).replace('{{title}}', esc(title)).replace('{{theme}}', color)
    (d / 'index.html').write_text(page, 'utf-8')
    (d / 'icon.svg').write_text(placeholder_icon(title, color), 'utf-8')
    print(f'{gid}/ を作りました(下書き)。')
    print(f'  1. {gid}/index.html にゲームを作る。保存キーは "{gid}-" で始める')
    print(f'  2. {gid}/game.json に紹介文・色・遊ぶ時間などを書く')
    print(f'  3. {gid}/icon.svg と 1200×630 の {gid}/og.png(共有画像。トップページの箱の表紙にもなる)を用意し、python3 tools/shelf.py images {gid}')
    print(f'  4. 並べてよくなったら game.json の status を "public" にして python3 tools/shelf.py build')


# ---------------------------------------------------------------- images (optional, needs Playwright)

FONT_CACHE = Path.home() / '.cache' / 'shelf-fonts'
WEIGHT_NAMES = {100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium',
                600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'}


def google_fonts_reachable():
    try:
        urllib.request.urlopen('https://fonts.googleapis.com/css2?family=Klee+One', timeout=5)
        return True
    except Exception:
        return False


def gfont_faces(css_url):
    """A Google Fonts css2 URL -> [(family, weight, path in github.com/google/fonts/ofl)]."""
    faces = []
    for fam in urllib.parse.parse_qs(urllib.parse.urlparse(css_url).query).get('family', []):
        name, _, axes = fam.partition(':')
        weights = [int(w) for w in axes[5:].split(';') if w.isdigit()] if axes.startswith('wght@') else [400]
        key = name.replace(' ', '')
        faces += [(name, w, f'{key.lower()}/{key}-{WEIGHT_NAMES.get(w, "Regular")}.ttf') for w in weights]
    return faces


def gfont_css(css_url):
    return '\n'.join(f"@font-face{{font-family:'{f}';font-weight:{w};font-display:block;src:url(https://fonts.gstatic.com/shelf/{p}) format('truetype')}}"
                     for f, w, p in gfont_faces(css_url))


def gfont_file(path):
    """Same font file as Google Fonts serves, fetched from the google/fonts repository and cached."""
    p = FONT_CACHE / path.replace('/', '__')
    if not p.exists():
        try:
            data = urllib.request.urlopen('https://raw.githubusercontent.com/google/fonts/main/ofl/' + path, timeout=60).read()
        except Exception:
            return None
        FONT_CACHE.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    return p.read_bytes()


def route_fonts(ctx):
    """Where fonts.googleapis.com is blocked (sandboxes, CI), serve the same fonts from the google/fonts repository."""
    def css(route):
        route.fulfill(status=200, content_type='text/css', body=gfont_css(route.request.url))

    def font(route):
        data = gfont_file(route.request.url.split('/shelf/', 1)[1])
        if data:
            route.fulfill(status=200, content_type='font/ttf', body=data, headers={'Access-Control-Allow-Origin': '*'})
        else:
            route.abort()
    ctx.route('https://fonts.googleapis.com/**', css)
    ctx.route('https://fonts.gstatic.com/shelf/**', font)


def data_uri(p, mime):
    return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()


def cmd_images(ids):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('images には Playwright が必要です: pip install playwright && python3 -m playwright install chromium')
    cfg = load_cfg()
    games = {g['id']: g for g in load_games()}
    targets = ids or ['portal']
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context()
        if not google_fonts_reachable():
            print('  Google Fonts に届かないので、GitHub の google/fonts から同じフォントを取ってきて描きます')
            route_fonts(ctx)
        pg = ctx.new_page()

        def shot(doc, w, h, out, transparent=False):
            pg.set_viewport_size({'width': w, 'height': h})
            pg.set_content(doc, wait_until='networkidle')
            pg.evaluate('document.fonts.ready.then(() => 1)')
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out), omit_background=transparent)
            print('  ' + rel(out))

        def icons(d, bg, app=True):
            svg = d / 'icon.svg'
            if not svg.exists():
                print(f'  ! {rel(svg)} がないのでアイコンは飛ばしました')
                return
            src = data_uri(svg, 'image/svg+xml')
            plain = '<html><body style="margin:0;background:transparent"><img src="{s}" width="{n}" height="{n}" style="display:block"></body></html>'
            boxed = '<html><body style="margin:0;background:{bg}"><div style="width:{n}px;height:{n}px;overflow:hidden;display:grid;place-items:center"><img src="{s}" width="{m}" height="{m}" style="flex:none;max-width:none"></div></body></html>'
            shot(plain.format(s=src, n=192), 192, 192, d / 'icon-192.png', True)
            # iOS は角を自分で丸めるので、角の透明部分が出ないよう少し拡大して四角く切る
            shot(boxed.format(s=src, n=180, m=round(180 * 1.15), bg=bg), 180, 180, d / 'apple-touch-icon.png')
            if app:  # ホーム画面に追加できるゲームだけ(manifest で使う)
                shot(plain.format(s=src, n=512), 512, 512, d / 'icon-512.png', True)
                shot(boxed.format(s=src, n=512, m=410, bg=bg), 512, 512, d / 'icon-maskable-512.png')

        for t in targets:
            if t == 'portal':
                icons(ROOT, cfg.get('icon_bg', '#d1dbe7'), app=False)
                pub = public_sorted(list(games.values()))[:2]
                boxes = ''
                for g in pub:
                    cover = g['_dir'] / g.get('cover', g.get('og_image', 'og.png'))
                    color = g.get('obi_color') or g.get('theme_color', '#3b3b3b')
                    img = f'<img src="{data_uri(cover, "image/png")}" alt="">' if cover.exists() else ''
                    boxes += f'<div class="box" style="--obi:{color};--obi-ink:{ink_on(color)}"><b class="obi">{esc(g["title"])}</b>{img}</div>'
                if len(pub) < 2:
                    boxes += f'<div class="box empty"><span>{esc(cfg.get("next_slot", ""))}</span></div>'
                lines = cfg.get('name_lines') or [cfg['name']]
                size = min(100, int(500 / (max(len(x) for x in lines) * 1.06)))
                doc = (TPL / 'portal-og.html').read_text('utf-8').replace('{{name_html}}', '<br>'.join(esc(x) for x in lines)).replace('{{name_size}}', str(size))
                doc = doc.replace('{{tagline}}', esc(cfg.get('tagline', ''))).replace('{{boxes}}', boxes)
                shot(doc, 1200, 630, ROOT / 'og.png')
            elif t in games:
                g = games[t]
                icons(g['_dir'], g.get('icon_bg') or g.get('theme_color', '#333333'))
            else:
                print(f'  ! {t} というゲームはありません')
        br.close()


def main():
    ap = argparse.ArgumentParser(description='押し入れゲーム棚の道具')
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build', help='トップページなどを作り直す')
    b.add_argument('--base', help='公開URL(例: https://example.github.io/games/)')
    n = sub.add_parser('new', help='新しいゲームの下書きを作る')
    n.add_argument('id')
    n.add_argument('title')
    sub.add_parser('check', help='決まりごとを確かめる')
    im = sub.add_parser('images', help='アイコンと共有画像を描き出す(Playwright が必要)')
    im.add_argument('ids', nargs='*')
    a = ap.parse_args()
    if a.cmd == 'build':
        cmd_build(a.base)
    elif a.cmd == 'new':
        cmd_new(a.id, a.title)
    elif a.cmd == 'check':
        games = load_games()
        errs, warns = run_checks(games)
        print(f'ゲーム {len(games)} 本: 直すところ {len(errs)} 件、気になるところ {len(warns)} 件')
        sys.exit(1 if errs else 0)
    elif a.cmd == 'images':
        cmd_images(a.ids)


if __name__ == '__main__':
    main()
