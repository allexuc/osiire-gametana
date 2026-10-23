#!/usr/bin/env python3
"""押し入れゲーム棚の通し確認(Playwright が必要)。リポジトリの一番上で:

  python3 tools/check_site.py               トップページ→各ゲーム→戻る、エラー、オフライン用キャッシュ、オフラインでの起動を確かめる
  python3 tools/check_site.py --shots DIR   あわせて、スマホ幅(390px)のスクリーンショットをライトとダークで DIR に保存する
  python3 tools/check_site.py --game ID     そのゲームだけ確かめる(下書きでも可)

リポジトリを 127.0.0.1 で配信して確かめる。fonts.googleapis.com に届かない環境では、shelf.py と同じく
GitHub の google/fonts から同じフォントを取ってきて表示する。問題があれば終了コード 1。
"""
import argparse, functools, http.server, importlib.util, sys, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('shelf', HERE / 'shelf.py')
shelf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shelf)
ROOT = shelf.ROOT


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.webmanifest': 'application/manifest+json', '.js': 'text/javascript'}

    def log_message(self, *args):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'


def main():
    ap = argparse.ArgumentParser(description='押し入れゲーム棚の通し確認')
    ap.add_argument('--shots', help='スクリーンショットを保存するフォルダ')
    ap.add_argument('--game', help='このゲームだけ確かめる')
    a = ap.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('check_site には Playwright が必要です: pip install playwright && python3 -m playwright install chromium')
    cfg = shelf.load_cfg()
    games = shelf.load_games()
    pub = shelf.public_sorted(games)
    targets = [g for g in games if g['id'] == a.game] if a.game else pub
    if a.game and not targets:
        sys.exit(f'{a.game} というゲームはありません')
    fails, page_errors, bad_files, state = [], [], [], {'offline': False}

    def ok(cond, msg):
        print(('OK   ' if cond else 'FAIL ') + msg)
        if not cond:
            fails.append(msg)

    srv, base = serve()
    route = not shelf.google_fonts_reachable()
    with sync_playwright() as p:
        br = p.chromium.launch()

        def context(scheme='light', scale=1):
            ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=scale, color_scheme=scheme)
            if route:
                shelf.route_fonts(ctx)
            return ctx

        font_host = lambda u: '//fonts.googleapis.com/' in u or '//fonts.gstatic.com/' in u

        def watch(pg):
            # 読み込めないファイルは console の文面ではなく、リクエストの結果で拾う(URL が分かるように)
            pg.on('pageerror', lambda e: page_errors.append(f'{pg.url}: {e}'))
            pg.on('console', lambda m: page_errors.append(f'{pg.url}: {m.text}') if m.type == 'error' and not state['offline'] and 'Failed to load resource' not in m.text else None)
            pg.on('response', lambda r: bad_files.append(f'{r.url} ({r.status})') if r.status >= 400 and not state['offline'] else None)
            # フォントを差し込んでいる環境では、sw.js が自分でフォントを取りに行って失敗するのは環境のせいなので数えない
            # ページを移ったときに打ち切られた読み込み(ERR_ABORTED)は失敗ではない
            pg.on('requestfailed', lambda q: bad_files.append(f'{q.url} ({q.failure})') if not state['offline'] and 'ERR_ABORTED' not in (q.failure or '') and not (route and font_host(q.url)) else None)

        def settle(pg):
            pg.wait_for_load_state('load')
            pg.evaluate('document.fonts.ready.then(() => 1)')
            pg.wait_for_timeout(400)

        hscroll = lambda pg: pg.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
        ctx = context()
        pg = ctx.new_page()
        watch(pg)
        if not a.game:
            r = pg.goto(base)
            settle(pg)
            ok(r.status == 200, 'トップページが開く')
            ok(pg.title() == cfg['name'], f'トップページの題名: {pg.title()}')
            hrefs = pg.eval_on_selector_all('.game:not(.next) .play', 'els => els.map(e => e.getAttribute("href"))')
            ok(hrefs == [g['id'] + '/' for g in pub], f'棚に並んだゲーム: {", ".join(hrefs) or "なし"}')
            drafts = [g['id'] for g in games if g.get('status') == 'draft']
            ok(not any(pg.query_selector(f'a[href^="{d}/"]') for d in drafts), '下書きは棚に出ていない' + (f'({", ".join(drafts)})' if drafts else ''))
            ok(pg.evaluate('[...document.querySelectorAll(".cover img")].every(i => i.complete && i.naturalWidth > 0)'), '箱の表紙が読み込める')
            ok(not hscroll(pg), 'トップページが横にはみ出さない')
        for g in targets:
            gid, url = g['id'], base + g['id'] + '/'
            if g in pub and not a.game:
                pg.goto(base)
                settle(pg)
                pg.click(f'.game:not(.next) .play[href="{gid}/"]')
                settle(pg)
                ok(pg.url == url, f'{gid}: 棚の「遊ぶ」から開く')
            else:
                r = pg.goto(url)
                settle(pg)
                ok(r.status == 200, f'{gid}: ページが開く')
            ok(bool(pg.title()), f'{gid}: ページの題名「{pg.title()}」')
            ok(not hscroll(pg), f'{gid}: 横にはみ出さない')
            back = pg.query_selector('a[href="../"], a[href="../index.html"]')
            ok(bool(back) and back.is_visible(), f'{gid}: 最初の画面にトップページへ戻るリンクがある')
            if back and back.is_visible():
                back.click()
                settle(pg)
                ok(pg.url in (base, base + 'index.html'), f'{gid}: 戻るリンクでトップページに戻れる')
            st = pg.evaluate(f"fetch('{url}manifest.webmanifest').then(r => r.status)")
            ok(st == 200, f'{gid}: manifest.webmanifest がある')
            if g.get('offline', True):
                pg.goto(url)
                settle(pg)
                # sw.js が先読みするファイルが1つでも欠けると動き出さないので、待つのは8秒まで
                scope = pg.evaluate("""navigator.serviceWorker.register('sw.js')
                  .then(r => Promise.race([navigator.serviceWorker.ready.then(() => r.scope), new Promise(res => setTimeout(() => res('8秒たっても動き出さない。sw.js が先読みするファイルが欠けていないか'), 8000))]))
                  .catch(e => '登録できない: ' + e.message)""")
                ok(scope == url, f'{gid}: sw.js の範囲がこのフォルダだけ({scope})')
                if scope != url:
                    continue
                cache = f'{gid}-v{g["version"]}'
                for _ in range(30):
                    if cache in pg.evaluate('caches.keys()'):
                        break
                    pg.wait_for_timeout(200)
                ok(cache in pg.evaluate('caches.keys()'), f'{gid}: オフライン用キャッシュ {cache} ができる')
                pg.reload()
                settle(pg)
                title = pg.title()
                state['offline'] = True
                ctx.set_offline(True)
                try:
                    pg.goto(url)
                    settle(pg)
                    ok(pg.title() == title, f'{gid}: オフラインでも開く')
                except Exception as e:
                    ok(False, f'{gid}: オフラインで開けない({str(e)[:80]})')
                ctx.set_offline(False)
                state['offline'] = False
        if not a.game:
            names = [f'{g["id"]}-v{g["version"]}' for g in targets if g.get('offline', True)]
            if len(names) > 1:
                have = pg.evaluate('caches.keys()')
                ok(all(n in have for n in names), f'ゲームごとのキャッシュが消し合わない({", ".join(names)})')
        ctx.close()
        if a.shots:
            out = Path(a.shots)
            out.mkdir(parents=True, exist_ok=True)
            for scheme in ('light', 'dark'):
                c = context(scheme, 2)
                q = c.new_page()
                watch(q)
                if not a.game:
                    q.goto(base)
                    settle(q)
                    q.screenshot(path=str(out / f'top_{scheme}.png'), full_page=True)
                for g in targets:
                    q.goto(base + g['id'] + '/')
                    settle(q)
                    q.screenshot(path=str(out / f'{g["id"]}_{scheme}.png'))
                c.close()
            print(f'スクリーンショット: {out}')
        br.close()
    srv.shutdown()
    ok(not page_errors, 'ページのエラー: ' + ('なし' if not page_errors else ' / '.join(dict.fromkeys(page_errors))[:400]))
    ok(not bad_files, '読み込めないファイル: ' + ('なし' if not bad_files else ' / '.join(dict.fromkeys(bad_files))[:400]))
    print(f'{len(fails)} 件の問題' if fails else 'すべて問題なし')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
