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
}

/** localStorageキー `invest_koro_state_v1` に保存する値の形。 */
export interface AppStateV1 {
  schema_version: 1;
  tickers: Ticker[];
}

export const STORAGE_KEY = "invest_koro_state_v1";

export const CURRENCY_BY_MARKET: Record<Market, Currency> = {
  JP: "JPY",
  US: "USD",
};
