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
 */
export interface AppStateV1 {
  schema_version: 1;
  tickers: Ticker[];
  trades?: Trade[];
}

export const STORAGE_KEY = "invest_koro_state_v1";

export const CURRENCY_BY_MARKET: Record<Market, Currency> = {
  JP: "JPY",
  US: "USD",
};
