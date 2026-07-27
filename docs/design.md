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

## (c) private側名前空間案(増分4で `state.json` 部分は実装済み。詳細は(g)節)

第1弾のmust全体(取引下書き・private repo双方向同期)はこの増分に含まれない。以下は後続増分がそのまま使えるよう、統合提言(§4アーキテクチャ)に沿って先に固定しておく設計案。

- 配置先: `personal-data`リポジトリ内 `invest-cockpit/` 名前空間配下(他アプリの個人データと衝突しないようアプリ名でネームスペースする、既存の相場帳バックアップと同じ命名規則)。
- 日次inboxパターン: `invest-cockpit/inbox/YYYY-MM-DD.json`(バッチが正規化して書き出す想定。アプリ内からは書き込まない=決定論バッチ経由が唯一の生成経路)。
- 必須フィールド(ファイル契約、`ai-linked-app-dev` Skillの型に準拠):
  - `schema_version`: 数値。破壊的変更時にインクリメント。
  - `as_of`: データが対象とする日付(`YYYY-MM-DD`)。生成時刻ではなくデータの鮮度基準。
  - `source`: データの出典(例: `"invest-agent"` `"kessan-navi"` `"manual"`)。
  - `generated_by`: `"deterministic" | "ai"`。AI生成物か決定論生成物かをアプリ側で常に区別表示できるようにする。
  - 冪等キー: 銘柄IDと`as_of`の組み合わせ(例: `"JP:7203#2026-07-27"`)。同キーの再生成は上書きとし重複を作らない。
- 個人状態(共通ウォッチ状態・建玉・ストップ・判断ログ・AI提案の採否)は`invest-cockpit/state.json`へ正本を移す想定。fine-grained PATでアプリからGitHub API経由の双方向同期を行う(taskchute-ipadの同期パターンを踏襲)。**増分4でこの`state.json`同期を実装した(詳細は(g)節)。** `invest-cockpit/inbox/YYYY-MM-DD.json`の日次inboxパターンは引き続き未実装(設計のみ)。
- localStorageからの移行は行わない: 増分4の同期は「localStorageの`AppStateV1`をそのまま`state.json`として全量置換で同期する」方式のため、別スキーマへの変換・移行手順は不要だった。

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

## (f) 増分3: 取引記録と建玉(ピラミッディング段階)

第1弾で見送った建玉・取引記録を実装する。private repo同期はまだ範囲外(引き続き(c)節は設計のみ)。localStorageの `AppStateV1` に `trades?: Trade[]` を加算的に追加する(`schema_version` は 1 のまま。旧データは `trades` 欠損として空配列扱い、`src/lib/storage.ts` `loadState`)。

**Trade契約**(`src/types.ts`)

```ts
interface Trade {
  id: string;          // 一意
  tickerId: string;    // 銘柄ID("<Market>:<Code>")
  side: "buy" | "sell";
  date: string;         // "YYYY-MM-DD"。new Date(文字列)禁止、input[type=date]の値をそのまま保持・表示
  qty: number;
  price: number;
  stop?: number;        // この取引時点で宣言する損切りライン
  reasonTags: ReasonTag[]; // プリセットから複数選択。自由入力はこの増分では持たない
  memo?: string;
  createdAt: string;
}
```

理由タグのプリセット(`REASON_TAG_PRESETS`): 高値ブレイク / 買い増し(ピラミッディング) / 決算好調 / 損切り / 利確 / ルール外(裁量)。

読み込みの寛容パースは行単位: 不正な`trade`要素は該当行だけを捨て、残りは生かす(`isValidTrade`)。

**建玉導出ルール**(`src/lib/position.ts` `computePosition`。stateには保存せず、`Trade[]`から毎回純関数で計算する)

- 対象銘柄のtradeを 日付→createdAt→id の順で安定ソートしてから順に処理する。
- 保有数量 = 買い数量合計 − 売り数量合計。売り超過は0でクランプし、マイナス建玉を作らない。
- 平均取得単価 = 買いの加重平均(平均単価法)。売りは数量のみ減らし、平均単価は変えない。保有数量が0になったら平均単価も0にリセットする(次の買いから新規に積み上げる)。保有数量0のとき`avgPrice`は`null`。
- 段数(ピラミッディング段階) = 買いtradeを古い順に1始まりで並べたもの(`stages`。日付・数量・単価を表示)。
- 現在の損切りライン(`currentStop`) = `stop`が宣言された最新のtrade(買い・売り問わず)の値。一度も宣言されていなければ`null`。
- 損切り到達時損失額(`stopLossAmount`) = `(平均取得単価 − currentStop) × 保有数量`。保有数量0または`currentStop`未宣言なら`null`。

**状態自動遷移**(`src/app.tsx` `handleAddTrade`)

- 買いを記録し、記録後の保有数量が0より大きくなった場合: `ticker.status` を `"holding"` にする。
- 売りを記録し、記録後の保有数量が0になった場合: `ticker.status` を `"sold"` にする。
- いずれも`updatedAt`を更新する。上記条件に当てはまらない記録(状態が変わらない買い増し・部分売却等)では状態を変更しない。

**取引記録の削除**: `TickerDetail`の各履歴行に削除ボタンを持つ(`window.confirm`で確認)。削除は`trades`配列から該当idを除くだけで、`ticker.status`は自動では戻さない(編集・状態の自動巻き戻しはこの増分のスコープ外)。建玉は削除後の`trades`から毎回再計算されるため、表示は自動的に整合する。

**UI**(`src/components/TickerDetail.tsx` / `TradeForm.tsx`)

- カルテ画面に建玉セクション(保有数量・平均単価・段数テーブル・損切りライン・到達時損失額。保有なしは「建玉なし」)と、「買いを記録」「売りを記録」ボタンを追加。ボタン押下で`TradeForm`(日付=今日デフォルト・数量・単価・stop任意・理由タグ複数選択)を開き、「記録する」で確定する。
- 取引履歴一覧は新しい順(日付desc、同日はcreatedAt desc)。
- 「今日」画面(`TodayQueue`)は`holding`グループの各行のうち建玉があるものだけ、保有数量・平均単価を1行サブ表示する(`TickerRow`の`position`prop)。
- 金額表示は`src/lib/format.ts` `formatMoney`で通貨記号付き・整数丸めにする(丸めは表示直前のみ。内部計算は`number`のまま)。

## (g) 増分4: private repo同期(トークンゲート方式)

(c)節の設計方針に沿って、`AppStateV1`全体を`personal-data`リポジトリの`invest-cockpit/state.json`へGitHub Contents API経由で双方向同期する。フィールドマージはせず**全量置換**。実装は`src/lib/sync.ts`(API層+同期ロジック)。

**同期先(固定・変更不可)**: `kojit1229/personal-data`リポジトリ、パス`invest-cockpit/state.json`、ブランチ`main`。通信先は`api.github.com`のみ。

**トークンゲート**: 設定画面(`#/settings`、`src/components/SettingsPage.tsx`)でfine-grained PAT(`personal-data`のContents読み書き権限のみ)を入力し、localStorageキー`invest_koro_token_v1`に平文保存する(`src/lib/sync.ts` `getToken`/`setToken`/`clearToken`)。**トークン未設定なら同期関連の関数(`pull`/`push`/競合解決)はすべて即座に`{ kind: "no-token" }`を返し、`fetch`を一切呼ばない**(mutation後のデバウンスpushもスケジュール自体をスキップする、`src/app.tsx`)。トークンをconsole・エラーメッセージ・`state.json`の中身に含めることはしない(`src/lib/sync.ts` `friendlyError`はHTTPステータスコードのみから文言を組み立てる)。

**`AppStateV1.lastModified`(増分3までのスキーマに加算)**: 全mutation時にローカル時刻文字列(`src/lib/date.ts` `nowStr()`形式)で更新する。`src/lib/storage.ts` `parseAppState`が旧データ(欠損)を`""`にフォールバックする。この値が新旧判定の基準。

**同期メタ(localStorageキー`invest_koro_sync_v1`)**: `{ lastSyncedSha, lastSyncedAt, lastSyncedModified }`。前回同期が取れた時点のリモートshaとローカル`lastModified`を保持する(`src/lib/sync.ts` `getSyncMeta`/内部の`setSyncMeta`)。

**決定表(`decideSyncAction`、純関数)**: `remoteChanged = meta.lastSyncedSha === null || remoteSha !== meta.lastSyncedSha`、`localChanged = meta.lastSyncedModified === null || localModified > meta.lastSyncedModified`として、

| remoteChanged | localChanged | 結果 |
|---|---|---|
| false | false | `in-sync`(何もしない) |
| false | true | `push-local`(ローカルが先行。自動push) |
| true | false | `adopt-remote`(リモートが先行。自動でローカルへ取り込み) |
| true | true | `conflict`(競合ダイアログ) |

`lastSyncedSha`/`lastSyncedModified`が未設定(一度も同期していない端末)の場合は常に「変更あり」とみなす。これにより、既存のリモートデータがある状態で新端末が初めてトークンを設定したときは無条件採用ではなく競合ダイアログに倒す(安全側)。

**pull(起動時・設定画面の「今すぐ同期」ボタン)**: `GET contents`でsha・内容を取得 → 404なら決定表を経由せずローカルをそのまま新規作成(`sha`無しPUT) → 200なら決定表で判定し、`in-sync`/`push-local`はそのまま処理してメタを更新、`adopt-remote`/`conflict`は取得済みのリモート内容を呼び出し側(`src/app.tsx`)へ返す。`adopt-remote`はダイアログなしで自動的にローカルへ適用し、`conflict`のみ`src/components/ConflictDialog.tsx`(「リモートを採用」/「この端末を採用」の2択)を表示する。

**push(mutation後3秒デバウンス・`src/app.tsx`のuseEffect)**: GETを挟まず、`meta.lastSyncedSha`を使って直接`PUT contents`する(pullより通信量が少ない)。GitHubが409または422(sha不一致)を返した場合は自動的に`pull`フローへフォールバックして再判定する。

**UTF-8 base64**: `toBase64Utf8`/`fromBase64Utf8`(`src/lib/sync.ts`)は`TextEncoder`/`TextDecoder`を経由し、`btoa`/`atob`の素の呼び出しによるマルチバイト文字破壊を避ける(taskchute-ipadの既存パターンを踏襲)。

**ヘッダー同期インジケータ(`src/components/SyncIndicator.tsx`)**: `unset`(未設定・グレー)/ `idle`(未同期・グレー)/ `syncing`(送信中)/ `synced`(同期済・緑)/ `error`(エラー・赤+短文)の5状態。エラー時もアプリのローカル機能(追加・状態変更・取引記録等)はすべて生き続ける(決定論のローカル保存が正規経路であり、同期はその上に乗る付加機能という位置づけ)。

**未実装・既知の制約**: (c)節の日次inboxパターン(`invest-cockpit/inbox/YYYY-MM-DD.json`)は引き続き未実装。競合解決の再帰リトライ(sha不一致の再発)は最大2回まで(`MAX_RECONCILE_ATTEMPTS`)。
