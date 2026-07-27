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
- **既知リスク: PATの同一オリジン共有**(reviewer中7): 増分4のfine-grained PAT(`invest_koro_token_v1`)はlocalStorageに平文保存する。`vite.config.ts`の`base: "/invest-cockpit/"`のとおり本アプリはproject pagesであり、オリジンは`https://kojit1229.github.io`で決算ナビ・需給ナビ・TaskChute Journal等と共有される(`src/lib/external.ts`が旧アプリのlocalStorageを読める根拠と表裏)。裏返せば、旧アプリ側のスクリプト(将来の外部ライブラリ導入含む)からこのブラウザ上でPATが読める。GitHub側での鍵の即時無効化はできる(パスワードに比べリスクは絞れる)が、「漏れない」ことを意味しない。設定画面(`SettingsPage.tsx`)の説明文にもこのリスクを明記する。設計変更(トークンの保存先分離等)は今は求めない。
- **既知リスク: state.jsonの外部送信(増分10a、reviewer中4)**: `batch/brief.sh`は`personal-data/invest-cockpit/state.json`(銘柄・建玉・stop・見送り履歴等)の抽出データを`claude -p`のプロンプトへ埋め込みAnthropicのモデルAPIへ送信する。private側データが外部(自宅端末外)のAI推論エンドポイントへ渡る唯一の経路であり、契約の詳細は(m)節を正典とする。



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

**`stop: 0`の正規化(Codex P1・後方互換、`src/lib/storage.ts` `normalizeRawTrade`)**: 新規入力(`TradeForm.tsx`)は`stop`を0以下の値では受け付けない(バリデーションエラー)。一方、読み込み時の寛容パースはこの制約を新規入力側の話として切り離す: 既存データに残る`stop: 0`(かつて許容していた・外部生成された等)は「stopが未宣言」の意味だったとみなし、パース時に`stop`フィールドごと取り除いて`undefined`(stop未宣言)へ正規化してから検証する。この正規化を行わずに`isValidTrade`の`stop > 0`検証だけへ通すと、`stop: 0`を含むtrade要素が寛容パースで丸ごと捨てられ、既存の取引記録(建玉・R倍数計算の入力)が静かに消えてしまう。

**建玉導出ルール**(`src/lib/position.ts` `computePosition`。stateには保存せず、`Trade[]`から毎回純関数で計算する)

- 対象銘柄のtradeを 日付→createdAt→id の順で安定ソートしてから順に処理する。
- 保有数量 = 買い数量合計 − 売り数量合計。売り超過は0でクランプし、マイナス建玉を作らない。
- 平均取得単価 = 買いの加重平均(平均単価法)。売りは数量のみ減らし、平均単価は変えない。保有数量が0になったら平均単価も0にリセットする(次の買いから新規に積み上げる)。保有数量0のとき`avgPrice`は`null`。
- ラウンド境界: 保有数量が0になった時点(フラット=建玉解消)を新ラウンドの開始点とする。`stages`・`currentStop`は直近のフラット以降のtradeだけから導出し、前ラウンドの段数・stop宣言は次ラウンドへ持ち越さない(フラットにした売り自体がstopを宣言していても、建玉が無くなった時点のものなので次ラウンドには引き継がずnullにリセットする)。
- 段数(ピラミッディング段階) = 直近のフラット以降の買いtradeを古い順に1始まりで並べたもの(`stages`。日付・数量・単価を表示)。
- 現在の損切りライン(`currentStop`) = 直近のフラット以降で`stop`が宣言された最新のtrade(買い・売り問わず)の値。フラット以降に一度も宣言されていなければ`null`。
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
- 金額表示は`src/lib/format.ts` `formatMoney`で通貨記号付き、通貨別の桁数(JPY=整数0桁 / USD=小数点2桁)で丸める(丸めは表示直前のみ。内部計算は`number`のまま)。JPY一律整数丸めだと USD建て銘柄(例: NVDA $123.45 → $123)で実害が出るため通貨別に分けた(reviewer中8)。

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

**安全側の例外**(`src/lib/sync.ts` `pull`。reviewer中5・中12): 決定表が`in-sync`/`push-local`/`adopt-remote`と判定しても、以下の場合は自動処理をせず`conflict`(競合ダイアログ)に倒す。

- ローカルが起動直後にlocalStorage破損から空状態へフォールバックした(`degraded`)状態で`in-sync`/`push-local`と判定された場合: 壊れた空stateでリモート正本を自動上書き、または同期基準点を壊れた値へ書き換える事故を防ぐ(呼び出し元は`src/lib/storage.ts` `loadState`の戻り値`degraded`を`src/app.tsx`が起動時pullにのみ伝える)。
- リモート受信データの一部要素(`tickers`/`trades`)が寛容パースで破棄されていた場合に`adopt-remote`と判定された場合: 破棄件数を検知した上での無告知自動採用を避け、ユーザーに選ばせる。

**pull(起動時・設定画面の「今すぐ同期」ボタン)**: `GET contents`でsha・内容を取得 → 404なら決定表を経由せずローカルをそのまま新規作成(`sha`無しPUT) → 200なら決定表で判定し、`in-sync`/`push-local`はそのまま処理してメタを更新、`adopt-remote`/`conflict`は取得済みのリモート内容を呼び出し側(`src/app.tsx`)へ返す。`adopt-remote`はダイアログなしで自動的にローカルへ適用し、`conflict`のみ`src/components/ConflictDialog.tsx`(「リモートを採用」/「この端末を採用」の2択)を表示する。

**push(mutation後3秒デバウンス・`src/app.tsx`のuseEffect)**: GETを挟まず、`meta.lastSyncedSha`を使って直接`PUT contents`する(pullより通信量が少ない)。GitHubが409または422(sha不一致)を返した場合は自動的に`pull`フローへフォールバックして再判定する。

**UTF-8 base64**: `toBase64Utf8`/`fromBase64Utf8`(`src/lib/sync.ts`)は`TextEncoder`/`TextDecoder`を経由し、`btoa`/`atob`の素の呼び出しによるマルチバイト文字破壊を避ける(taskchute-ipadの既存パターンを踏襲)。

**ヘッダー同期インジケータ(`src/components/SyncIndicator.tsx`)**: `unset`(未設定・グレー)/ `idle`(未同期・グレー)/ `syncing`(送信中)/ `synced`(同期済・緑)/ `error`(エラー・赤+短文)の5状態。エラー時もアプリのローカル機能(追加・状態変更・取引記録等)はすべて生き続ける(決定論のローカル保存が正規経路であり、同期はその上に乗る付加機能という位置づけ)。

**未実装・既知の制約**: (c)節の日次inboxパターン(`invest-cockpit/inbox/YYYY-MM-DD.json`)は引き続き未実装。競合解決の再帰リトライ(sha不一致の再発)は最大2回まで(`MAX_RECONCILE_ATTEMPTS`)。

## (h) 増分5(第1弾最終): 今日の判断キュー(決定論イベント)

既存パイプライン(決算ナビ・需給ナビ)の公開JSONをクライアント側で読み、決定論イベントを毎回計算して「今日の判断キュー」として今日画面(`TodayQueue`)の先頭に表示する。**保存はしない**(ロードのたびに再計算)。実装は`src/lib/pipeline.ts`(fetch+スキーマ検証+正規化)と`src/lib/events.ts`(イベント判定の純関数)。

**外部JSONの契約(この増分の実装時点、2026-07-27に実ファイルを読んで確認した事実)**

決算ナビ(`repos/stock_analyze/frontend/data/`。GitHub Pagesではfrontendがサイトルート):
- `schedule.json`: 配列。要素は`{ code: string, date: "YYYY-MM-DD", fiscal_type: string }`(決算発表予定日一覧)。
- `meta.json`: `{ generated_at: "YYYY-MM-DDTHH:mm:ss", sources: {...}, counts: {...} }`。データ日付は`generated_at`の先頭10文字を文字列切り出しして使う(`new Date()`へは渡さない)。
- 本番URL: `/stock_analyze/frontend/data/schedule.json` / `/stock_analyze/frontend/data/meta.json`(ルート相対。開発環境では404が正常)。

需給ナビ(`repos/stock_supply_demand`。生成データは`gh-pages`ブランチのみに存在し、mainブランチには無い。設計原則「mainに生成データを置かない」による):
- `data/prices/{code}.json`: `{ schema_version: 1, code: string, weekly: { dates: string[], close: (number|null)[] }, daily: { dates: string[], close: (number|null)[] } }`(週次は3年分・約158点、日次は直近30点。`collector/prices.py`のfile contract)。対象は`config/price_list.json`記載の約226銘柄(日経225+K注目銘柄)のみ。
- `data/prices_meta.json`: `{ schema_version: 1, latest_price_date: "YYYY-MM-DD", generated_at: string, price_count: number }`。データ日付は`latest_price_date`をそのまま使う。
- 本番URL: `/stock_supply_demand/data/prices_meta.json` / `/stock_supply_demand/data/prices/{code}.json`(ルート相対。開発環境では404が正常)。

**fetchの失敗隔離**(`src/lib/pipeline.ts` `loadPipelineData`): 決算ナビ・需給ナビは別々に`fetchJson`(例外を投げずnullを返す)でfetchし、`Promise.all`で並行取得する。一方が失敗してももう一方の判定は生きる。需給ナビは銘柄ごとに`data/prices/{code}.json`を個別fetchするため、1銘柄の404が他銘柄の取得を妨げない。`prices_meta.json`が読めない場合は需給ナビ全体を取得失敗扱いにする(鮮度表示の基準がないため)。すべてのfetchに`{ cache: "no-cache" }`を指定する(reviewer中11): GitHub Pagesは`Cache-Control: max-age=600`を返すため未指定だと最大10分古いブラウザキャッシュを使いうる。判断キューは鮮度が命のため、決算ナビ本体(`repos/stock_analyze/frontend/app.js`)と同じ方針で毎回再検証させる。

**イベント種別**(`src/lib/events.ts`。対象は状態が`candidate`/`watching`/`holding`のJP銘柄のみ。`sold`/`passed`は判断が済んだ銘柄として対象外とした、この増分の実装判断):
- 決算接近(`detectEarningsEvents`): 決算発表予定日が今日から7日以内(当日含む、`daysBetween`が0〜7)。
- 高値接近/更新(`detectHighEvents`。対象は候補/監視/保有すべて): 「最新値」(日次closeの末尾有効値、無ければ週次closeの末尾有効値)が週次3年高値(weekly.closeの最大値)の95%以上で「高値接近」、100%を超えたら「高値更新」。週次終値ベース(日中の真の高値ではない)であることをUIラベルで明示するため、表示文言は「3年高値(週足終値)」とする(`src/lib/events.ts`の`detail`文言・`TickerDetail.tsx`。reviewer中9)。
- 損切り接近(`detectStopEvents`。対象は`holding`のみ): 建玉(`computePosition`)の`currentStop`に対し、最新値がstopの103%以下で「損切りライン接近」、stop未満で「損切りライン割れ」。
- `buildJudgmentQueue`が3種を統合し、損切り→決算→高値→銘柄名の順で安定ソートする。

**日付比較**: `src/lib/date.ts` `daysBetween(a, b)`を追加(2つの"YYYY-MM-DD"を年/月/日に数値分解し`Date.UTC`で構築してから差分日数を返す。文字列をそのまま`new Date()`へは渡さない)。決算7日判定・鮮度警告(7日超で「古いデータ」)の両方で使う。

**UI**:
- `TodayQueue`の先頭に`JudgmentQueue`セクション。イベント0件なら「今日judgmentが必要な変化はありません」。各カードは種別バッジ・銘柄名・根拠数値・データ日付・カルテへのリンク。下部に「出典: 決算ナビ(YYYY-MM-DD) / 需給ナビ(YYYY-MM-DD)」(取得中は「取得中…」、fetch失敗は「取得不可(ローカル機能は正常)」、7日超は「(古いデータ)」を付記)。
- `TickerDetail`にも株価セクション(JP銘柄のみ)を追加: 最新株価・3年高値(週足終値)からの距離(または「高値更新中」)・保有時はstopまでの距離(%)。対象226銘柄に無い(またはJPでない)銘柄は「価格データなし(対象226銘柄外)」。

**未実装・既知の制約**: US銘柄はそもそも価格・決算データソースの対象外(需給ナビ・決算ナビともJP専用のため、判断キュー・カルテ株価セクションともにJPのみ)。イベント判定は`candidate`/`watching`/`holding`限定(`sold`/`passed`はカルテの株価セクション自体は引き続き表示するが、判断キューには出ない)。

## (i) 増分7: ポジションサイズ計算機・見送りワンタップ

`AppStateV1`に`settings?: AppSettings`(`src/types.ts`)を加算的に追加する。`schema_version`は1のまま。旧データ(欠損)は`undefined`として扱い、`TradeForm`は許容損失額の空欄から始める(`src/lib/storage.ts` `isValidSettings`が数値以外の値を持つフィールドをundefinedへ寛容フォールバックする)。`Ticker`にも`passedEvents?: PassedEvent[]`を加算的に追加する(旧データは空配列扱い、`src/lib/storage.ts` `isValidPassedEvent`が行単位の寛容パースを行う)。**この行単位パースは要素単位(Codex P2、`normalizeRawTicker`)**: `passedEvents`配列中の不正な要素だけを`filter`で取り除き、ticker本体(銘柄)は落とさない。以前の実装は`isValidTicker`が`passedEvents.every(isValidPassedEvent)`で配列全体の真偽を取っていたため、見送り履歴1件の破損が銘柄そのものを寛容パースのフィルタで丸ごと消してしまっていた。

**ポジションサイズ計算機**(`src/lib/positionSize.ts` `recommendPositionSize`、純関数)

- 契約: 推奨株数 = `floor(許容損失額 ÷ (エントリー価格 − stop))`。JP銘柄は単元株(100株)単位に切り下げ、US銘柄は1株単位(`market`パラメータで判定)。
- エントリー価格がstop以下の場合は`null`を返す。呼び出し側(`TradeForm`)はこれを「stopはエントリーより下に」というエラー表示に変換する。
- `maxLoss`(丸め後の実際の最大損失額 = `qty * (entryPrice - stop)`)も合わせて返す。

**UI統合**(`src/components/TradeForm.tsx`、買い側のみ)

- 単価・stopの入力欄の直後に許容損失額入力欄(`currencySymbol`で通貨記号のみ表示、`src/lib/format.ts`)を追加する。既定値は設定画面(`#/settings`)の`AppSettings.defaultRiskJPY`/`defaultRiskUSD`(銘柄の通貨に応じてどちらかを`TickerDetail`が選んで渡す)。
- 単価・stop・許容損失額がすべて入力されると「推奨株数: N株(この取引の最大損失 ¥X)」を自動表示し、「この株数を使う」ボタンで数量欄へ反映する。単価・stopが入力済みでエントリー<=stopの場合はエラー文言のみ表示する(許容損失額の入力有無に関わらず表示する)。
- 買い増し時(既存建玉あり、`computePosition(trades, tickerId).qty > 0`)は、フォームに入力中のstopを使って「現在の建玉全体でstopに到達した場合の合計損失」も併記する。実装は`qty: 0, price: 0`で当該stopだけを宣言する仮想tradeを既存tradeの末尾に足して`computePosition`へ通す方式(`stopLossAmount`が既存の保有数量・平均取得単価に対して新stopを適用した値になる。今回追加する数量は含めない)。トレーリングストップ(stopを平均取得単価より上へ引き上げた場合)は`stopLossAmount`が負値になるため、`TickerDetail.tsx`の建玉セクション(reviewer軽微19)と同じく符号でラベルを切り替える(正なら「合計損失」、負なら「到達時利益額(トレーリングストップ)」、値は絶対値で表示。reviewer中2で「合計損失」表記のまま`Math.abs`していた不整合を修正)。

**設定画面**(`src/components/SettingsPage.tsx`)

- 「ポジションサイズ計算機の既定」セクションを追加し、`defaultRiskJPY`/`defaultRiskUSD`をそれぞれ数値入力・保存する。0以下・非数・空欄は`undefined`に落とす(`App.tsx` `handleSettingsChange`が`state.settings`を丸ごと置き換える。フィールド単位のマージはしない)。

**見送りワンタップ**(`src/types.ts` `PassReasonTag`/`PassedEvent`、`src/app.tsx` `handleOpenPass`/`handleConfirmPass`)

- 理由タグプリセット(`PASS_REASON_TAG_PRESETS`、複数選択可、自由入力なし): 高値まで遠い / 出来高・流動性不足 / 決算またぎ回避 / 地合い悪い / ルール外 / その他。
- 導線は2箇所から同じダイアログ(`src/components/PassDialog.tsx`)を開く: (a) カルテ画面(`TickerDetail`)の状態セレクタ横「見送る」ボタン、(b) 今日の判断キュー(`TodayQueue`の`JudgmentQueue`)の各イベントカードの「見送る」ボタン。どちらも`onOpenPass(tickerId)`(`App.tsx`の状態`passTarget`)を呼び、ダイアログはタグを1つ以上選ばないと確定できない(学習ループの入力データになるため空タグを許さない)。
- 確定(`handleConfirmPass`)で対象銘柄の`status`を`"passed"`にし、`passedEvents`へ`{ date: todayStr(), tags }`を追記する。append-onlyで上限20件、超過分は古いものから削除する(`MAX_PASSED_EVENTS`)。記録経路はこのワンタップのみに限定する(他の経路から`passedEvents`を書き換えない)。
- カルテ画面に見送り履歴セクションを表示する(日付+タグ、`passedEvents`を反転した配列=最新順)。0件は「見送り記録はありません」。

## (j) 増分8: 需給ドーナツ(売り圧vs買い圧)

銘柄カルテの「株価」セクションの下(JP銘柄のみ)に、需給ナビの公開JSONから売り圧/買い圧をSVG自前描画のドーナツで可視化する。**保存はしない**(カルテを開くたびにその銘柄のコードだけを対象にfetchする。増分5の株価セクションと違い、全銘柄分の事前一括fetchはしない)。実装は`src/lib/supplyDemand.ts`(fetch+検証+集計の純関数)と`src/components/SupplyDemandDonut.tsx`(SVG描画+凡例)。

**実データ監査結果(この増分の実装時点、2026-07-27に`repos/stock_supply_demand`のgh-pagesブランチ・collectorソース・既存監査メモを読んで確認した事実)**

`repos/stock_supply_demand`の生成データは**mainブランチではなくgh-pagesブランチにのみ存在**(既存の増分5と同じ注意点)。本番URLは`kojit1229.github.io/stock_supply_demand/`配下のルート相対パス。

1. **JSDA週次貸借(`collector/jsda_weekly.py`)**: `data/meta.json` = `{schema_version, latest_week, generated_at, issue_count, weekly_count}`(`latest_week`が最新報告日)。`data/weekly/{report_date}.json` = `{schema_version, report_date, source_files, issues}`で`issues`は銘柄コード(4-5桁、JSDA統一コード末尾0落とし済み)をキーとするマップ、各要素`{name, taishaku: {yutanpo?: M, mutanpo?: M}, shinki: {...}}`(`M = {lend_qty, lend_amt, own_qty, own_amt, ten_qty, ten_amt}`、単位は株/百万円)。**前週比列(元xlsxにはある)はこの収集コードが出力から落としている**ため、前週比は自前で前週ファイルとの差分計算が必要。
2. **JPX機関投資家空売り残高報告(0.5%以上、`collector/jpx_short.py`)**: `data/short_meta.json` = `{schema_version, latest_short_date, generated_at}`。`data/short/{code先頭2桁}.json`(コード単位ではなく2桁シャード) = `{schema_version, issues: {code: {name, events: [{date, ratio, qty, seller}]}}}`。同一(銘柄,報告者)の連続日再掲パターン(既存監査メモ`audit-notes.md`)のため、現在有効な残高は「報告者ごとの最新event」を集約して算出する。**シャードファイルは該当2桁に該当銘柄が1件もない場合は生成されない**(`collector/jpx_short.py`の`shards.setdefault`はデータがある2桁のみ作る)ため、シャード404は「そのプレフィックスに空売り報告銘柄が無い」という正常系であり、エラー扱いにしない。
3. **日証金日次貸借(`collector/jsf_taishaku.py`)**: `data/taishaku_meta.json` = `{schema_version, latest_apply_date, generated_at, snapshot_count}`。`data/taishaku/{apply_date}.json` = `{schema_version, apply_date, settle_date, report_type, issue_count, issues}`で`issues[code]` = `{name, yushi_zan(融資残高株数), kashikabu_zan(貸株残高株数), yushi_shin, yushi_hen, kashikabu_shin, kashikabu_hen, sashihiki_zan, seido_kai, seido_uri}`。`seido_kai`/`seido_uri`(制度信用・買/売残高株数)は**多くの銘柄でnull**(実測、2026-07-23確報の7203含む複数銘柄で確認)のため本カードでは使わない。時系列格納`taishaku_series/{2桁}.json`(design.md想定の増分14a)は**2026-07-27時点でgh-pagesに未生成**(snapshot 2件のみ)のため、前日比は直近2件のスナップショットを個別fetchして自前差分する方式にする。
4. **既存`signals.json`は存在しない**(gh-pagesの`data/`配下を確認したが無い)。当初案の「バッジがあれば優先」は不成立のため、判定は倍率のみで行う。

**セグメント割当と配色(赤=買い、緑=売り。moomoo慣習に合わせる確定方針の実装)**

- 買い圧(赤、1セグメント): 「信用買い残(代理: 日証金融資残高)」= `taishaku/{date}.json`の`yushi_zan`。日証金の融資(証券金融会社が証券会社へ資金を貸す)は信用買いの決済原資であり、信用買い需要の直接の代理変数(`audit-shinyou.md`と符合)。
- 売り圧(緑、3セグメント。濃淡3段階):
  1. 「借株需要(代理: JSDA貸付残高)」= `weekly/{date}.json`の対象コードの`taishaku.yutanpo.lend_qty + taishaku.mutanpo.lend_qty`(欠損側は0扱い)。**「信用売り残」や「空売り残高」と言い切らない**: `stock_supply_demand`側の既存監査メモ(`audit-notes.md`)が「JSDA貸付残高は転貸ダブルカウントの可能性→借株需要の代理変数として表示(空売り残高そのものと言わない)」と既に方針化しており、本アプリの表示もこれを踏襲する。JSDA週次データの`借入残高(自己/転貸)`2フィールドは、投資家の買い需要とは異なる「貸借取引の原資調達」側の数値でありbuy/sellの代理指標として使う根拠が無いため、この増分では使わない(未使用フィールドとして意図的に除外)。
  2. 「機関投資家空売り報告 合計」= `short/{2桁}.json`の対象コードの`events`を報告者ごとに最新1件へ集約し、`qty > 0`(まだ有効な報告)のものを合計。
  3. 「信用売り残(代理: 日証金貸株残高)」= `taishaku/{date}.json`の`kashikabu_zan`。
- 単位はすべて株数(金額列は使わない。JPX機関空売り報告に金額が無く単位を統一できないため)。
- ドーナツの弧の長さは固定の左右半分割りではなく、**買い合計・売り合計それぞれの全体に対する実比率**で描く(不均衡がそのまま視覚化される。既存デザインは弧配分方式を明記していなかったため、この増分の実装判断として記載する)。

**中央指標(貸借倍率、2026-07-27修正)**(`classifyTaishakuRatio(yushiZan, kashikabuZan)`、純関数): 中央の要約指標はドーナツ全セグメント(JSDA貸付残高等を含む合算)の比率ではなく、**貸借倍率 = 日証金融資残高(`yushi_zan`) ÷ 日証金貸株残高(`kashikabu_zan`)**(標準指標)に固定する。旧実装は買い残高(日証金融資残高のみ)÷売り残高合計(JSDA貸付残高+JPX機関空売り報告+日証金貸株残高)の比率で判定していたが、JSDA貸付残高がJPXの機関貸株プールで桁が2桁以上大きく、大型株で常に極端な売り優勢に振れる不具合があった(本番実測: トヨタで信用倍率0.01倍)。ラベルは「貸借倍率(日証金)」。判定: `yushi_zan/kashikabu_zan`が1.0超で「買い長」、1.0未満で「売り長」(ちょうど1.0はsell-dominant側に丸める。仕様は>1.0/<1.0の2条件のみのため境界値の扱いはこの増分の実装判断)。`kashikabu_zan`が0または欠損(日証金ソースが取得不可、または対象コードが日証金データに無い)は「算出不可」。ドーナツのセグメント構成自体(JSDA・JPXを含む3ソース)は変更しない。

**前週比/前日比の計算方法**(データ提供側に履歴一覧APIが無いため、日付を推測して個別fetchし404なら「比較データなし」):
- JSDA週次・JPX機関空売り報告は**前週比**、日証金日次のみ**前日比**(確定方針どおり)。
- JSDA: 前週ファイルの日付は`subtractDays(report_date, 7)`を最優先候補とし、祝日で前週が木曜にずれるケース(`audit-notes.md`既知)に備え`6`日前・`8`日前の順で追加候補を試す(`src/lib/date.ts` `subtractDays`)。最初に200で取れたものを比較対象にする。全滅なら`diff: null`(凡例の矢印なし)。
- 日証金: `subtractDays(latest_apply_date, n)`を`n=1,2,3,4`の順で試し、最初に取れたスナップショットと比較する(週末・祝日をスキップする目的)。
- JPX機関空売り報告: 追加fetchはせず、既に取得済みの`events`配列から「報告者ごとの直近1件のうちcutoff日(`subtractDays(latest_short_date, 7)`)以前のもの」を集約し比較対象にする(cutoff以前に報告が無い報告者は0扱い)。
- 鮮度表示(`asOf`)は各セグメントが実際に参照した日付をそのまま出す(JSDAは`report_date`、日証金は`apply_date`、JPX空売り報告は集約元データの性質上`short_meta.json`の`latest_short_date`を鮮度ラベルとして使う。個々の報告者の最新報告日がそれより古い場合があり得る点は、比較窓の起点を`latest_short_date`基準に統一するための簡略化として扱う)。

**エラー処理**(既存パターン踏襲。ソースごとに独立、`src/lib/supplyDemand.ts` `loadSupplyDemandData`):
- 各ソースの「meta+最新データ本体」の取得に失敗した場合のみ、そのソースをエラー扱いにする(`errors`配列)。カルテ側の対象コードがそのソース内に存在しない(0件)ことはエラーではない(JSDA対象外銘柄・空売り報告が無い銘柄は通常のケース)。JPXのシャード404も上記の理由により通常ケース。
- 3ソースすべてがエラー、かつセグメントが0件 → 「取得不可」。エラー0件でセグメントが0件 → 「需給データなし」。それ以外はドーナツを描画し、エラーになったソースだけ「取得不可: <ソース名>」を凡例末尾に注記する。
- **JPXシャード取得の404/障害の区別(Codex P2、2026-07-27追加)**: `src/lib/pipeline.ts` `fetchJson`(404も含めすべての失敗を`null`に畳む)はこの区別ができないため、JPX空売りシャード(`loadJpxShortSegment`)専用に`fetchJsonWithStatus`(`{kind:"ok"|"not-found"|"error"}`を返す)を使う。404は`not-found`(=「このプレフィックスに空売り報告銘柄が無い」正常系、`error: false`のまま)、ネットワーク例外・5xx・`res.json()`のパース失敗は`error`(=障害、`error: true`にしてUIに「取得不可」を出す)として区別する。他ソース(JSDA・日証金)のmeta/本体fetchは従来どおり`fetchJson`のまま(このレビュー対応の対象外)。

## (k) 増分9: 週次レビュー画面

新ルート`#/review`(`src/lib/router.ts`)。今日画面のヘッダー直下に「週次レビューを見る」リンクを置く(`src/app.tsx`)。入力は`state.trades`と`state.tickers`のみ(すべてローカル計算・外部fetch不要・保存はしない。開くたびに再計算する)。実装は`src/lib/review.ts`(純関数群)と`src/components/ReviewPage.tsx`(表示)。

**ラウンドの定義**: 建玉が0になった時点(フラット)を境界とする一連の取引のまとまり(`src/lib/position.ts` `splitRounds`)。増分3の建玉導出(`computePosition`)と本増分の週次レビューが同じ境界基準を共有するよう、ラウンド分割ロジックを`splitRounds`として`position.ts`に抽出し両方から使う(重複実装によるズレを防ぐ)。「クローズ済みラウンド」は`splitRounds`が返す`closed: true`のラウンドのみを指す(直近の未クローズ=保有中のラウンドは週次レビューの集計対象外)。

**数量不整合ラウンドの除外(Codex P2 + reviewer中3、2026-07-27追加)**: `splitRounds`はラウンド内で保有数量を超える売り(買いを一度も記録せず単独で売った退化ケースを含む)を検知すると、そのラウンドに`qtyMismatched: true`を付ける(数量超過分は従来どおり0でクランプし、マイナス建玉は作らない)。`qtyMismatched`なラウンドは、データ不整合(買いの手動削除・誤入力等)が前提のためpnl・R・増し玉寄与の数値を信頼できない。`summarizeByCurrency`はこのフラグが立つラウンドを`closedRoundCount`・勝率・PF・R・増し玉寄与の**すべての集計から除外**し、除外件数を`mismatchedCount`として返す(サマリカードに警告文で表示)。ラウンド一覧表(`RoundListTable`)自体からは除外せず、行に「数量不整合」の警告タグを付けて表示する(黙って架空の損益を計上しない。存在自体はKに見えるようにする)。

**ラウンド損益(pnl)**: 売り合計金額(`Σ qty*price`、売りtradeのみ) − 買い合計金額(`Σ qty*price`、買いtradeのみ)。ラウンドは開始・終了とも建玉0のため、平均単価法を経由せずこの単純差分が正しい実現損益になる。

**R倍数**: `R = pnl / initialRisk`。`initialRisk = (entryPrice - stop) * qty`(ラウンド最初の買いtradeの値)。最初の買いに`stop`が未宣言、または`entryPrice <= stop`(初期リスクが0以下)の場合は`initialRisk`・`R`ともに`null`とし、R計算対象外として件数(`rExcludedCount`)を別途集計する(仕様は「stop未宣言」のみ明記しており、entry<=stopの扱いはこの増分の実装判断)。「平均R倍数」と「R期待値」はこの増分では同一の値(R計算対象ラウンドの単純平均)として扱う。

**プロフィットファクター(PF)**: 通貨ごとに`総利益(pnl>0の合計) / 総損失(pnl<0の絶対値合計)`。総損失が0かつ総利益>0(全勝)の場合はPFを数値として出さず「全勝(損失なし)」と表示する(0除算回避、`allWinsNoLosses`)。クローズ済みラウンドが0件の通貨は「この通貨のクローズ済み取引はありません」。

**増し玉寄与(ピラミッディング、買いtradeが2件以上のラウンドのみ算出)**: 初期玉(ラウンド最初の買いのqty・price)だけを買い、ラウンドの平均売却単価(`avgExitPrice = 売り合計金額 / 売り合計数量`)で売り切ったと仮定した仮想P&L = `qty0 * (avgExitPrice - entryPrice0)`。実際のP&Lとの差分(`pnl - virtualPnl`)が増し玉の寄与額。正なら「買い増しが利益に寄与」、負なら「買い増しが損失を拡大」。通貨ごとに対象ラウンドの寄与額を合算して表示する。

**サマリ・ラウンド一覧・見送り集計**:
- サマリ(通貨別2カード、JPY/USD): クローズ済みラウンド数・勝率(勝ちラウンド数/クローズ済みラウンド数)・PF・平均R倍数(R期待値)。通貨は混ぜない(`src/lib/review.ts` `summarizeByCurrency`)。
- ラウンド一覧表: 銘柄名(カルテへのリンク)・期間(開始日〜終了日)・段数(買いtrade件数)・損益(通貨別`formatMoney`)・R倍数・理由タグ(ラウンド内の全tradeの`reasonTags`を重複排除して結合)。終了日の新しい順。
- 見送り集計: 全銘柄の`Ticker.passedEvents`を合算し日付降順に並べた直近20件(この画面独自の集計範囲。各銘柄側のpassedEvents保存上限20件<増分7節>とは別の概念)の範囲でタグ別件数を数える(`computePassedEventTagCounts`)。0件のタグは表示しない。
- 該当データが無い場合の空状態: クローズ済みラウンド0件は「クローズ済みの取引がまだありません」、見送り記録0件は「見送り記録はありません」、ピラミッディング対象0件は「ピラミッディング(2段以上)したラウンドはありません」。

## (l) 増分10: 引け後ブリーフ表示・採否キュー(第2弾最終)

`batch/brief.sh`(増分10a)が生成する`personal-data`リポジトリの引け後ブリーフ(AI反対意見つき)を今日画面に表示し、各counterpointへの採否(参考になった/却下)を記録する。実装は`src/lib/brief.ts`(fetch+検証)、`src/components/BriefCard.tsx`(表示)。ブリーフ本文はstateに保存しない(表示のたびに毎回fetchする。採否記録だけが学習シグナルとしてstateに残る)。

**ブリーフの契約(取得専用、正典は`batch/brief-validate.py`)**: GitHub Contents API経由で`personal-data`リポジトリの`invest-cockpit/brief/{YYYY-MM-DD}.json`を読む。`{ schema_version:1, as_of, generated_at, generated_by:"ai", model, summary, counterpoints:[{tickerId, stance:"反対意見"|"見落とし"|"確認事項", text, basis:string[]}], health:{sources:{kessan,jukyu,state}} }`。取得は今日→前日→前々日の順に最大3日分試行し(`src/lib/date.ts` `subtractDays`)、最初に200+検証成功したものを採用する(404は正常系、それ以降の日程は試行しない)。通信先は`api.github.com`のみ、認証は増分4の同期と同じfine-grained PAT(`src/lib/sync.ts` `getToken`)を共用する。**トークン未設定ならfetchを一切呼ばず`{ kind: "no-token" }`を返す**(トークンゲート、`src/lib/brief.ts` `loadBrief`)。3日分すべて404・ネットワークエラー・スキーマ検証失敗は`{ kind: "unavailable" }`にまとめ、呼び出し側(`src/app.tsx`)は`no-token`/`unavailable`のどちらもブリーフを`null`として扱う(区別しない。取得失敗してもアプリの他機能は無影響)。

**表示(`src/components/BriefCard.tsx`)**: 今日画面(`TodayQueue`)の`JudgmentQueue`直下にカードを描画する(`brief===null`ならカード自体を出さない。空状態はカードを出さないことで判断キューを邪魔しない設計方針、増分5と同じ)。カードの内容: `as_of`日付(`daysBetween(as_of, today) > 3`で「古いブリーフ」警告を赤字併記)+`summary`+`counterpoints`一覧(各要素: stanceバッジ(3色。反対意見=赤/見落とし=橙/確認事項=青)+`tickerId`が`state.tickers`に存在すればカルテへのリンク、存在しなければID文字列そのまま表示+`text`+`basis`箇条書き+採否ボタン)。ヘッダーに`generated_by:"ai"`を明示する「AI生成」バッジを常設し、決定論イベント(判断キュー)との出所を視覚的に区別する。

**採否キュー(`AppStateV1.briefFeedback`)**: 加算的フィールド`briefFeedback?: BriefFeedback[]`(`src/types.ts`)。

```ts
interface BriefFeedback {
  date: string;           // ブリーフのas_of
  tickerId: string | null; // 対象銘柄ID。空文字列はnullに正規化する
  stance: string;
  verdict: "adopted" | "dismissed";
  decidedAt: string;       // nowStr()形式
  textPrefix: string;      // counterpoint.textの先頭32字(下記突合キーの一部)
}
```

`textPrefix`は実装判断で追加した加算的フィールド(以下の突合キー仕様「date+tickerId+stance+textの先頭32字」を満たすため。同一銘柄・同一stanceで複数counterpointが将来発生した場合に区別する)。append-only、上限50件・超過分は古い順に削除(`src/app.tsx` `handleBriefFeedback`、`MAX_BRIEF_FEEDBACK`)。同一キー(date+tickerId+stance+textの先頭32字)の重複記録はしない(UIのボタン無効化に加え、`handleBriefFeedback`内でも二重防御)。

**突合キー**: `date`(ブリーフのas_of)+`tickerId`(`counterpoint.tickerId`。空文字列は`null`)+`stance`+`text.slice(0, 32)`(`src/lib/brief.ts` `briefFeedbackTextPrefix`)の完全一致。一致する`briefFeedback`要素があれば当該counterpointの「参考になった」「却下」ボタンを無効化し、判断結果(採用済み/却下済み)を表示する(`src/components/BriefCard.tsx`)。

**読み込みの寛容パース**(`src/lib/storage.ts` `isValidBriefFeedback`): 行単位。不正な要素は該当行だけを捨て、残りは生かす(`isValidPassedEvent`と同じ方針)。旧データ(`briefFeedback`欠損)は空配列として扱う。

**未実装・既知の制約**: 設定画面でトークンを新規設定した直後は、次回ページ再読み込みまでブリーフは再取得されない(マウント時1回のみのfetch。増分4の同期のように`handleTokenChanged`からの即時再取得は行わない。この増分のスコープ外)。

## (m) 増分10a: `batch/brief.sh`(引け後ブリーフ生成バッチ)の契約

(l)節はアプリ側(取得・表示・採否記録)の契約のみを規定する。バッチ本体(`batch/brief.sh` / `brief-collect.py` / `brief-validate.py`)の契約はこの節を正典とする(reviewer中4。以前はスクリプトのヘッダコメントにしか存在しなかった)。

**運用状態(2026-07-27時点)**: `loop/standing-flows.md`のNEVER 9白名単に未登録・K承認待ち。承認が下りるまで実行しない(スクリプト冒頭コメントに同旨を明記)。

**出力ファイル契約(固定・変更不可)**: `personal-data`リポジトリの`invest-cockpit/brief/YYYY-MM-DD.json`。スキーマは(l)節のブリーフ契約と同一(`{schema_version:1, as_of, generated_at, generated_by:"ai", model, summary, counterpoints:[...], health:{sources:{kessan,jukyu,state}}}`)。生成物のバリデーションは`brief-validate.py`が正典で、不正ならファイルを出さずexit 1(フェイルラウド)。

**入力**: `personal-data/invest-cockpit/state.json`(無ければ空状態として続行し`health.state=false`)+ 決算ナビ/需給ナビの公開JSON(GitHub Pages本番)。`brief-collect.py`がソース単位で失敗を隔離する。

**冪等規則**: 冪等キーは`as_of`(=当日日付)の1日1ファイル。`git pull --ff-only`の**後**に当日ファイルの存在をチェックする(他マシンで既に生成・push済みの当日分を見落として二重生成しないため)。当日ファイルが存在し、かつローカルHEADにそのファイルへのcommitはあるが上流(リモート追跡ブランチ)へ届いていない場合(前回実行がcommit後・push前に失敗した状態)は、生成(claude呼び出し)をやり直さずpushだけ再試行する(2026-07-27修正、reviewer中1「M1」: 旧実装はファイル存在だけを見ていたため、push失敗で死んだ日は以後永久に再生成がスキップされ、ブリーフが二度とpushされない穴があった)。`--force`は当日ファイルを無条件に上書きする。

**保持方針**: 削除しない(2026-07-27修正、reviewer重大R1)。旧実装は保持14日を超えた過去ファイルを同コミットで`git rm`していたが、personal-dataへの削除系操作はNEVER 9白名单(b)「作成系のみ」の境界外のため除去した。保持日数の再設計(削除するか・何日分か)はK承認後に別途行う。それまで`brief/`配下は増え続ける。

**予算・多重起動防止**: 実行前に`cost-check.sh --stage invest-koro-brief`で日次予算(既定$1.00、`BRIEF_BUDGET`)を確認し、超過時は今回分をスキップする(queueへは積まない)。同時多重起動はPIDロックファイル(`memory/collect/invest-koro-brief.lock`)で防止する(`analyze-kessan.sh`と同方式)。

**path限定push(二重防御)**: commit前に`personal-data`の変更が`invest-cockpit/brief/`配下だけであることを確認し、それ以外の変更(他バッチが同じ作業ツリーに残した未コミット変更等)を検出したらpushせずdieする(ファイル自体は書き込み済みで失われない)。

**個人データの外部送信(プライバシー注記、reviewer中4)**: `brief.sh`は`state.json`から`brief-collect.py`が抽出したコンテキスト(保有銘柄・建玉数量・平均取得単価・stop・見送り履歴等)と決算ナビ/需給ナビの公開JSONを`claude -p`の標準入力(=プロンプト)としてAnthropicのモデルAPI(`$BRIEF_MODEL`、既定`claude-sonnet-5`)へ送信する。これは本アプリの個人データが自宅端末の外(モデル推論エンドポイント)へ渡る唯一の経路であり、(d)節の公開/privateデータ境界における例外事項として明記する。`--allowedTools ""`でclaude側のツール実行はすべて無効化しており、送信は「プロンプトとしての読み取り専用データ」に限られる(claude側からの追加fetch・ファイル操作は発生しない)。認証情報(GitHubトークン等)は本バッチが直接扱わない(git credential helper任せ)ため、この送信経路には含まれない。

**dry-run**: `git pull`・公開JSON取得・claude呼び出し・push元をすべてスキップし、固定のダミーhealth/candidate JSONで`brief-validate.py`の検証配線だけを確認する(personal-dataへは一切書き込まない)。
