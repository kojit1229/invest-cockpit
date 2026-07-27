# 投資航路 — ファイル契約・設計文書

設計の正典: `workbench/out/2026-07-27-invest-app-proposal/final-recommendation.md` および `codex-proposal.md`(統合提言・第1弾計画)。本文書はその「must」のうち第1増分で固定するファイル契約を記す。監督者確定・変更禁止(変更する場合は正典側の改訂を先に行う)。

## (a) 銘柄状態機械

状態は5つ。第1弾のUIはどの状態間の遷移も手動選択で許可する(強制はしない)が、想定される標準フローは以下。

```
candidate(候補) --監視開始--> watching(監視)
watching(監視)  --建玉を持つ--> holding(保有)
holding(保有)   --全量売却--> sold(売却済)
candidate/watching --見送り判断--> passed(見送り)

再検討の戻り遷移:
passed(見送り) --再検討--> candidate(候補)
watching(監視) --監視解除--> candidate(候補)
sold(売却済)   --再エントリー検討--> candidate(候補)
```

- `candidate`: 気づいたが未検証。決算・需給・価格位置をまだ十分見ていない。
- `watching`: 検証済みでエントリー条件を待っている。
- `holding`: 建玉を持っている(第1弾は状態のみ。建玉数量・ストップ等の詳細フィールドは後続増分)。
- `sold`: 全量売却済み。振り返り対象として残す(削除しない)。
- `passed`: 見送った。見送り理由の記録は第2弾(`should`)で追加する。

第1弾では建玉・取引記録・ストップは実装しない(統合提言の第1弾スコープのうち「銘柄状態機械の最小動作」のみを先行させ、取引下書き・建玉表示は後続増分で追加する)。

## (b) localStorage v1 スキーマ

- キー: `invest_koro_state_v1`
- 値(JSON):

```jsonc
{
  "schema_version": 1,
  "tickers": [
    {
      "id": "JP:7203",           // 市場プレフィックス付き銘柄ID。"<Market>:<Code>"
      "name": "トヨタ自動車",      // 表示名。ユーザー入力
      "currency": "JPY",          // "JPY" | "USD"(市場から自動決定)
      "status": "watching",       // candidate|watching|holding|sold|passed
      "createdAt": "2026-07-27T09:00:00", // 追加時刻(ローカルタイムゾーン、YYYY-MM-DDTHH:mm:ss)
      "updatedAt": "2026-07-27T09:00:00", // 最終更新時刻(状態変更のたびに更新)
      "importedFrom": "需給ナビ"           // 任意。旧アプリからの一回限りインポートで追加された場合の由来ラベル。手動追加の銘柄には存在しない
    }
  ]
}
```

- 読み込みは寛容パース: JSON破損・`tickers`欠損・要素の型不一致は無視し、空状態(`{schema_version:1, tickers:[]}`)にフォールバックする(`src/lib/storage.ts` `loadState`)。アプリを落とさないことを優先し、破損データを上書きするかはユーザー操作(新規保存)に委ねる。
- 書き込みは常に本スキーマで行う(`saveState`)。未知フィールドを書き出すことはない。
- 冪等性: `id`が銘柄の一意キー。同一`id`の追加はエラーメッセージを返し拒否する(`src/app.tsx` `handleAdd`)。
- この増分はlocalStorageのみが正本。端末間同期はない(次節(c)で後続増分の設計方針のみ示す)。

## (c) private側名前空間案(後続増分・未実装)

第1弾のmust全体(取引下書き・private repo双方向同期)はこの増分に含まれない。以下は後続増分がそのまま使えるよう、統合提言(§4アーキテクチャ)に沿って先に固定しておく設計案。

- 配置先: `personal-data`リポジトリ内 `invest-cockpit/` 名前空間配下(他アプリの個人データと衝突しないようアプリ名でネームスペースする、既存の相場帳バックアップと同じ命名規則)。
- 日次inboxパターン: `invest-cockpit/inbox/YYYY-MM-DD.json`(バッチが正規化して書き出す想定。アプリ内からは書き込まない=決定論バッチ経由が唯一の生成経路)。
- 必須フィールド(ファイル契約、`ai-linked-app-dev` Skillの型に準拠):
  - `schema_version`: 数値。破壊的変更時にインクリメント。
  - `as_of`: データが対象とする日付(`YYYY-MM-DD`)。生成時刻ではなくデータの鮮度基準。
  - `source`: データの出典(例: `"invest-agent"` `"kessan-navi"` `"manual"`)。
  - `generated_by`: `"deterministic" | "ai"`。AI生成物か決定論生成物かをアプリ側で常に区別表示できるようにする。
  - 冪等キー: 銘柄IDと`as_of`の組み合わせ(例: `"JP:7203#2026-07-27"`)。同キーの再生成は上書きとし重複を作らない。
- 個人状態(共通ウォッチ状態・建玉・ストップ・判断ログ・AI提案の採否)は将来的にこの名前空間の別ファイル(例: `invest-cockpit/state.json`)へ正本を移す想定。fine-grained PATでアプリからGitHub API経由の双方向同期を行う(taskchute-ipadの同期パターンを踏襲)。
- この増分では上記は**設計のみ**で実装しない。localStorageからの移行手順(一回限りインポート)は実装増分で別途定義する。

## (d) 公開/private データ境界

- **公開側(本リポジトリ、GitHub Pages配信)**: アプリコード(HTML/CSS/JS)のみ。個人の銘柄リスト・建玉・ストップ・判断ログ・AI提案は一切含めない。個人状態を公開repoへ自動コミットする設計は踏襲しない(統合提言「移行時の要監査事項」で問題視されたパターン)。
- **private側(`personal-data`リポジトリ、後続増分)**: 銘柄の共通ウォッチ状態、建玉、ストップ、投資仮説、判断ログ、採否ログ、AI生成物。(c)節の名前空間に集約する。
- **第1増分時点の実データ所在**: localStorage(ブラウザ端末内)。これは技術的には「公開でも private でもない、端末ローカル」であり、GitHub Pagesの配信物には含まれない(ソースコードのみが配信される)。ただし端末間同期がないため、複数端末で使う場合は同一の状態が見えない制約がある。この制約はprivate repo同期(後続増分)で解消する。
- GitHub Pagesの罠(`ai-linked-app-dev` Skill既知の原則): 「repoをprivateにすれば守られる」は誤り。本アプリの公開repoには最初から個人データを書き込む経路を作らない設計とする(ログイン画面も作らない。トークンゲート方式は private同期実装時に導入)。

## (e) 増分2の調査結果(旧アプリの外部連携。事実として確認済み)

GitHub Pagesは同一アカウントの全アプリが同一オリジン(`kojit1229.github.io`)のため、投資航路から他アプリのlocalStorageを直接読める(書き込みはしない)。以下は `repos/stock_supply_demand` と `repos/stock_analyze` のソースを実際に読んで確認した事実(推測ではない)。参照はこの増分の実装時点(2026-07-27)のもの。旧アプリ側の実装が変わればズレる可能性があるため、`src/lib/external.ts` の読み込みは寛容パース(壊れた形式は「読み込めません」表示にフォールバックし、例外を投げない)。

**需給ナビ (`repos/stock_supply_demand/index.html`)**
- localStorageキー: `jukyu_watchlist_v1`(`WATCHLIST_KEY`、`index.html:532`)
- 値のスキーマ: `{ "schema_version": 1, "codes": ["7203", "285A", ...] }`(`codes`はJSDA銘柄コードの文字列配列。`loadWatchlist`/`saveWatchlist`、`index.html:686-707`)
- 銘柄コード単体の詳細ページURL: ハッシュルート `#/issue/<code>`(`index.html:646`, `index.html:2332`)
- 銘柄名はlocalStorageに保存されていない(表示時に`data/*.json`から`state.issueByCode[code]`で引く。`index.html:2241`, `index.html:2251`)。このためインポート候補の名称はcodeそのものを暫定値として使う。

**決算ナビ (`repos/stock_analyze/frontend/local-api.js`)**
- localStorageキー: `kessan_local_v1`(`STORE_KEY`、`local-api.js:116`)
- 値のスキーマ: `{ mystocks: [{ user_id, code, registered_at, last_checked_at, holding_type, importance, memo, notify }], disclosures: [...], nextDiscId }`(`local-api.js:143-146`, `490-510`)。マイ銘柄は`mystocks`配列で、キーは`code`(TSE 4桁コードの文字列)。
- 銘柄コード単体の詳細ページURL: ハッシュルート `#/stock/<code>`(`frontend/app.js:878`、各所のリンク生成で使用)
- `mystocks`要素にも銘柄名は保存されていない(名称は`stocksByCode`経由で`data/*.json`から都度引く)。需給ナビ同様、インポート候補の名称はcodeを暫定値とする。

**投資航路側のURL構築方針**
- 深掘りリンクは本番のGitHub Pages URLを直書きする(`src/lib/external.ts` `kessanNaviUrl` / `jukyuNaviUrl`): `https://kojit1229.github.io/stock_analyze/#/stock/<code>` と `https://kojit1229.github.io/stock_supply_demand/#/issue/<code>`。開発環境(`npm run dev`)では投資航路自体のoriginが異なるためリンク先は開けないが、本番相当のURLを常に指すことを優先した(投資航路がどこで動いていても旧アプリは常にGitHub Pages上にあるため)。
- 両アプリともJP銘柄コードのみを扱う(USはそもそも対象外)。投資航路のticker ID(`<Market>:<Code>`)から`Market`が`JP`の場合のみ深掘りリンクを表示する。
