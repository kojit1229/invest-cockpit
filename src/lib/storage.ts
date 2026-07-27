// データアダプタ: localStorage v1。private repo同期は後続増分(docs/design.md (c) 参照)。
// 方針: 壊れたデータでもアプリを落とさない(寛容パース)。書き込みは常に正規スキーマで行う。

import { AppStateV1, STORAGE_KEY, Ticker, TickerStatus, TICKER_STATUSES } from "../types";

function emptyState(): AppStateV1 {
  return { schema_version: 1, tickers: [] };
}

function isValidTicker(v: unknown): v is Ticker {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    (t.currency === "JPY" || t.currency === "USD") &&
    typeof t.status === "string" &&
    TICKER_STATUSES.includes(t.status as TickerStatus) &&
    typeof t.createdAt === "string" &&
    typeof t.updatedAt === "string"
  );
}

/** localStorageから状態を読む。破損・欠損・未知schema_versionは空状態にフォールバックする(例外を投げない)。 */
export function loadState(): AppStateV1 {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return emptyState();
    const obj = parsed as Record<string, unknown>;
    // schema_versionが1以外(未知バージョン・欠損)は破損扱いとしてフォールバックする。
    if (obj.schema_version !== 1) return emptyState();
    const tickers = Array.isArray(obj.tickers) ? obj.tickers.filter(isValidTicker) : [];
    return { schema_version: 1, tickers };
  } catch {
    // 壊れたJSON等。既存データは触らず、アプリは空状態から動作を継続する。
    return emptyState();
  }
}

export function saveState(state: AppStateV1): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // iOS Safariのプライベートブラウズ/ロックダウンモード等でlocalStorageが使えない場合がある。
    // 保存に失敗してもアプリは落とさない。
    console.warn("saveState failed", e);
  }
}

export function statusCount(tickers: Ticker[], status: TickerStatus): number {
  return tickers.filter((t) => t.status === status).length;
}
