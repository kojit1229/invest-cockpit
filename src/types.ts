// 投資航路 — 共通ドメイン型
// 設計の正典: docs/design.md。この増分ではlocalStorageのみ(private repo同期は後続増分)。

/** 市場プレフィックス付き銘柄ID。例: "JP:7203" / "US:NVDA" */
export type TickerId = string;

export type Currency = "JPY" | "USD";

/** 銘柄状態機械の5状態。遷移図は docs/design.md (a) を正とする。 */
export type TickerStatus =
  | "candidate" // 候補
  | "watching" // 監視
  | "holding" // 保有
  | "sold" // 売却済
  | "passed"; // 見送り

export const TICKER_STATUSES: TickerStatus[] = [
  "candidate",
  "watching",
  "holding",
  "sold",
  "passed",
];

export const STATUS_LABEL_JA: Record<TickerStatus, string> = {
  candidate: "候補",
  watching: "監視",
  holding: "保有",
  sold: "売却済",
  passed: "見送り",
};

/** 市場プレフィックス。銘柄IDの先頭を決める。 */
export type Market = "JP" | "US";

/**
 * 見送り理由タグ プリセット(複数選択可、増分7の確定仕様)。
 * 追加・変更する場合は docs/design.md 側の契約を先に改訂すること。
 */
export const PASS_REASON_TAG_PRESETS = [
  "高値まで遠い",
  "出来高・流動性不足",
  "決算またぎ回避",
  "地合い悪い",
  "ルール外",
  "その他",
] as const;

export type PassReasonTag = (typeof PASS_REASON_TAG_PRESETS)[number];

/** 見送り判断1件(ワンタップ記録、増分7)。append-onlyで`Ticker.passedEvents`に積む。 */
export interface PassedEvent {
  /** YYYY-MM-DD形式(文字列Date解析は禁止。表示・記録専用) */
  date: string;
  tags: PassReasonTag[];
}

/**
 * ポジションサイズ計算機の既定許容損失額(通貨別、増分7)。設定画面(#/settings)で編集し、
 * TradeForm(買い側)の初期値に使う。未設定フィールドはTradeForm側で空欄から始める。
 */
export interface AppSettings {
  defaultRiskJPY?: number;
  defaultRiskUSD?: number;
}

export interface Ticker {
  id: TickerId;
  name: string;
  currency: Currency;
  status: TickerStatus;
  /** YYYY-MM-DD形式(文字列Date解析は禁止。表示・記録専用) */
  createdAt: string;
  updatedAt: string;
  /** 旧アプリからの一回限りインポートで追加された場合の由来ラベル(例: "需給ナビ")。手動追加はundefined。 */
  importedFrom?: string;
  /**
   * 見送り履歴(増分7で追加した加算的フィールド)。append-only、上限20件で古いものから削除する
   * (`src/app.tsx` `handlePass`)。旧データ(欠損)は空配列として扱う(`src/lib/storage.ts` loadState)。
   * 学習ループの入力データになるため、記録経路は「見送る」ボタン経由のワンタップ記録のみに限定する
   * (docs/design.md 増分7節)。
   */
  passedEvents?: PassedEvent[];
}

/** 取引の売買方向。 */
export type TradeSide = "buy" | "sell";

/**
 * 取引記録の理由タグ プリセット(複数選択可、自由入力なし。増分3の確定仕様)。
 * 追加・変更する場合は docs/design.md 側の契約を先に改訂すること。
 */
export const REASON_TAG_PRESETS = [
  "高値ブレイク",
  "買い増し(ピラミッディング)",
  "決算好調",
  "損切り",
  "利確",
  "ルール外(裁量)",
] as const;

export type ReasonTag = (typeof REASON_TAG_PRESETS)[number];

/** 1件の取引記録(買い/売り)。建玉はstateに保存せず、これを元に毎回導出する(src/lib/position.ts)。 */
export interface Trade {
  id: string;
  tickerId: TickerId;
  side: TradeSide;
  /** YYYY-MM-DD形式(文字列Date解析は禁止。表示・記録専用) */
  date: string;
  qty: number;
  price: number;
  /** この取引時点で宣言する損切りライン。任意。 */
  stop?: number;
  reasonTags: ReasonTag[];
  memo?: string;
  createdAt: string;
}

/** Trade新規作成時の入力形(id/createdAtはApp側で採番する)。 */
export type TradeInput = Omit<Trade, "id" | "createdAt">;

/**
 * localStorageキー `invest_koro_state_v1` に保存する値の形。
 * `trades` は増分3で追加した加算的フィールド(schema_versionは1のまま)。
 * 旧データ(trades欠損)は空配列として扱う(src/lib/storage.ts loadState)。
 * `lastModified` は増分4で追加した加算的フィールド。全mutation時に更新するローカル時刻文字列
 * (`src/lib/date.ts` `nowStr()`形式)で、private repo同期の新旧判定に使う
 * (docs/design.md 増分4節)。旧データ(欠損)は""として扱う(loadStateで正規化するため、
 * アプリ内で生きているAppStateV1は常に文字列を持つ)。
 * `settings` は増分7で追加した加算的フィールド。ポジションサイズ計算機の既定の許容損失額
 * (通貨別)を保持する。未設定(欠損)ならTradeForm側は空欄から始める(docs/design.md 増分7節)。
 */
export interface AppStateV1 {
  schema_version: 1;
  tickers: Ticker[];
  trades?: Trade[];
  lastModified: string;
  settings?: AppSettings;
}

export const STORAGE_KEY = "invest_koro_state_v1";

export const CURRENCY_BY_MARKET: Record<Market, Currency> = {
  JP: "JPY",
  US: "USD",
};
