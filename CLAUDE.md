# CLAUDE.md

このリポジトリは「押し入れゲーム棚」。ブラウザゲームを1本1フォルダで並べ、GitHub Pages(main / root)で https://allexuc.github.io/osiire-gametana/ に公開している。人向けの説明は README.md。

ユーザーへの返事は日本語で書く。

## 手で直さないファイル(build が作る)

- `index.html`(トップページ)、各ゲームの `manifest.webmanifest` と `sw.js`、README.md の `<!-- shelf:url -->` と `<!-- shelf:games -->` の中、各ゲームの index.html の og:image・og:url
- 元を直してから `python3 tools/shelf.py build`。トップページの見た目は `tools/templates/portal.html`、置き場の名前や公開URLは `shelf.json`、ゲームの紹介・色・版は `<ID>/game.json`

## ゲームの決まりごと

- 1本1フォルダ `<ID>/`。ID は英小文字で始まる英小文字・数字・ハイフンで、URL にもなる。新しいゲームは `python3 tools/shelf.py new <ID> <タイトル>` から始める(status が draft の間は棚に出ないが、URL では開ける)
- 本体は `<ID>/index.html`。外から読み込むのは Google Fonts だけにする(オフラインで遊べるように)。ほかのファイルは同じフォルダに置き、オフラインで要るものは game.json の `precache` に書く
- localStorage のキーは `<ID>-` で始める。トップページ用の記録は `shelf:<ID>` に `{"t": ミリ秒, "note": "一言", "resume": 続きがあるか}`
- リンクは相対パス(GitHub Pages ではリポジトリ名がパスに入る)。最初の画面にトップページへ戻るリンク(`../`)を出し、ホーム画面から起動したときは隠す
- スマホ縦(390px)で遊べること、ライトとダーク、タップだけで遊べることを基本にする
- ルールの計算は画面と分け、Node で自動プレイできるようにする(札上の楼閣は `// ==ENGINE START==` から `// ==ENGINE END==` までを `<ID>/tools/sim.js` が読む)。乱数はシード付き
- ゲームを直したら、game.json の `version` とゲーム内の版表示を同じ番号に上げてから build する(sw.js のキャッシュ名が変わり、遊ぶ人の手元も新しくなる)
- 箱の表紙と共有画像を兼ねる 1200×630 の `<ID>/og.png`、アイコンは `<ID>/icon.svg` から `python3 tools/shelf.py images <ID>`

## 確かめる

1. `python3 tools/shelf.py check`(決まりごと)
2. `python3 tools/check_site.py --shots <フォルダ>`(Playwright)。トップページ→各ゲーム→戻る、エラー、読み込めないファイル、オフライン、スクリーンショット。下書きは `--game <ID>`。撮ったスクリーンショットは自分で見る
3. ゲームのシミュレーター。ボットがふだんしない極端な遊び方も試す(札上の楼閣は `cd satsujo && node tools/sim.js index.html 1000`、`THIN=10` で薄いデッキ、`LEGACY=8` で10枚未満の古いセーブ)

## 公開

- コミットメッセージは日本語。末尾にはそのセッションで指定された帰属行を付ける
- push の前に `git fetch origin main` して、必要なら rebase する
- push すると Pages が数分で作り直される。この環境のシェルからは github.io に届かないので、`gh api repos/allexuc/osiire-gametana/actions/runs` で「pages build and deployment」が success になったかで確かめる
- push が 403(Claude doesn't have GitHub access)になったら、Claude の GitHub アプリの設定でこのリポジトリへのアクセスを許可してもらう

## 環境の注意

- fonts.googleapis.com に届かない。shelf.py の images と check_site.py は GitHub の google/fonts から同じフォントを差し込んで描く。自分で Playwright を使うときも `tools/shelf.py` の `route_fonts(context)` を使うと、実際の見た目で確かめられる

## 札上の楼閣(satsujo/)

- 分割した開発用ソースはない。`satsujo/index.html` が本体なので、そのまま直す。版は `const VERSION='…'`
- 設計書は Claude Docs: https://claude.ai/artifact/BFKJPzxHsmX7SQBr6WA4sy 。ルールや数値を変えたら設計書も直す
- 楼閣は10マス。デッキの下限 `MIN_DECK` は10(下回ると楼閣が完成できず詰む)

## 一線打尽(amida/)

- いまは下書き(game.json の status が draft、v0.1.0)。棚に並べるときは status を public にし、version と `const VERSION='…'` を上げて build
- 分割した開発用ソースはない。`amida/index.html` が本体(ルールの計算は `// ==ENGINE START==` から `// ==ENGINE END==`、画面はそのあとの script)
- 設計書は Claude Docs: https://claude.ai/artifact/F3UVhoQWdPT3Cab3kVJ4CC 。ルールや数値を変えたら設計書も直す
- 盤は縦線5本・7段。同じ段で縦線を共有する横線は置けない(`canPut`)。横線1本で入れ替わるのは、その高さで隣り合う2つの駒の行き先だけ
- 敵の予告のうち横槍・消しゴム・移動などはターンの終わりに起き、場所はターンの始めに決める(`revealIntents`)。画面の見込みは `clash` をそのまま使う(b を書き換えない)
- シミュレーター: `cd amida && node tools/sim.js index.html 300`。`BOT=normal`(数か所だけ試すボット)、`STICKERS=all`、`PENS=hl,red`、`LINEUP=sumo,sumo,…`、`NODRAW=1`、`FILL=1`(盤を埋めて書けないとき)、`TUNE="章:HP倍率,攻撃倍率"`
