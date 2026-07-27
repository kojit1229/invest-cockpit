// データアダプタ: localStorage v1。private repo同期は後続増分(docs/design.md (c) 参照)。
// 方針: 壊れたデータでもアプリを落とさない(寛容パース)。書き込みは常に正規スキーマで行う。

import { AppStateV1, STORAGE_KEY, Ticker, TickerStatus, TICKER_STATUSES, Trade } from "../types";

function emptyState(): AppStateV1 {
  return { schema_version: 1, tickers: [], trades: [], lastModified: "" };
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
    typeof t.updatedAt === "string" &&
    (t.importedFrom === undefined || typeof t.importedFrom === "string")
  );
}

/**
 * 取引記録の寛容パース(増分3)。不正な行は該当tradeだけを捨て、残りは生かす。
 * reasonTagsはプリセット外の文字列が混ざっていても(将来のプリセット変更に備え)配列の形だけ検証する。
 */
function isValidTrade(v: unknown): v is Trade {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.tickerId === "string" &&
    (t.side === "buy" || t.side === "sell") &&
    typeof t.date === "string" &&
    typeof t.qty === "number" &&
    Number.isFinite(t.qty) &&
    t.qty > 0 &&
    typeof t.price === "number" &&
    Number.isFinite(t.price) &&
    t.price >= 0 &&
    (t.stop === undefined || (typeof t.stop === "number" && Number.isFinite(t.stop) && t.stop > 0)) &&
    Array.isArray(t.reasonTags) &&
    t.reasonTags.every((tag) => typeof tag === "string") &&
    (t.memo === undefined || typeof t.memo === "string") &&
    typeof t.createdAt === "string"
  );
}

/**
 * strict解析時、寛容フィルタで捨てた要素数を呼び出し側へ伝えるための出力先(reviewer中12)。
 * `tickers`/`trades`の不正要素が同期受信データでサイレントに切り捨てられ、そのまま
 * adopt-remoteでローカルへ適用・再pushされる事故を防ぐため、呼び出し側(src/lib/sync.ts)が
 * 破棄件数を見て自動適用を止められるようにする。
 */
export interface ParseAppStateStats {
  droppedTickers: number;
  droppedTrades: number;
}

/**
 * 生JSON文字列から寛容パースでAppStateV1を得る(要素単位)。トップレベルが解析不能・非object・
 * 未知schema_versionの場合はnullを返す(呼び出し側がフォールバック方針を決める)。
 * ローカル(loadState)とprivate repo同期の受信データ(src/lib/sync.ts)の両方から使う共通パーサ。
 * 重要: ローカル読み込みは「壊れていたら空状態」で安全だが、同期の受信データをここで
 * 空状態に丸めてしまうと同期取り込み側が「リモートは意図的に空になった」と誤認し、
 * ローカルの実データを上書きしかねない。そのため失敗はnullで明示し、空状態への
 * フォールバックはこの関数の外(loadStateのみ)で行う。
 *
 * `opts.strict`(Codex P2): 同期受信データ用の検証強化。`tickers`が配列でない(欠損・型不一致)
 * 場合、通常は空配列へ寛容フォールバックするが、strictではnullを返し不正データとして拒否する。
 * `schema_version: 1`のリモートデータで`tickers`が欠損しているケースを「意図的な空state」として
 * 誤って採用し、ローカルの全銘柄を消してしまう事故を防ぐ。ローカル読み込み(loadState)は
 * 従来どおり寛容フォールバックのまま維持するため、strictを渡さない。
 *
 * `opts.stats`(reviewer中12): 渡された場合、`tickers`/`trades`のうち`filter`で捨てた要素数を
 * 書き込む。呼び出し側(sync.ts)はこれを見て「一部破棄された受信データ」を検知できる。
 */
export function parseAppState(
  raw: string,
  opts?: { strict?: boolean; stats?: ParseAppStateStats },
): AppStateV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    // schema_versionが1以外(未知バージョン・欠損)は破損扱い。
    if (obj.schema_version !== 1) return null;
    if (opts?.strict && !Array.isArray(obj.tickers)) return null;
    const rawTickers = Array.isArray(obj.tickers) ? obj.tickers : [];
    const tickers = rawTickers.filter(isValidTicker);
    // tradesは増分3で追加した加算的フィールド。欠損(旧データ)は空配列として扱う。
    const rawTrades = Array.isArray(obj.trades) ? obj.trades : [];
    const trades = rawTrades.filter(isValidTrade);
    if (opts?.stats) {
      opts.stats.droppedTickers = rawTickers.length - tickers.length;
      opts.stats.droppedTrades = rawTrades.length - trades.length;
    }
    // lastModifiedは増分4で追加した加算的フィールド。欠損(旧データ)は""として扱う。
    const lastModified = typeof obj.lastModified === "string" ? obj.lastModified : "";
    return { schema_version: 1, tickers, trades, lastModified };
  } catch {
    return null;
  }
}

export interface LoadStateResult {
  state: AppStateV1;
  /**
   * true: localStorageに値は存在したが破損・未知schema_versionで空状態にフォールバックした
   * (reviewer中5)。この直後に同期(pull)が走ると、壊れた空stateがリモート正本を上書きしうる
   * ため、呼び出し側(src/app.tsx)はこのフラグが立っている間、自動push/自動採用を安全側
   * (競合ダイアログ)に倒すこと。localStorageにキー自体が無かった(新規端末)場合はfalse。
   */
  degraded: boolean;
}

/** localStorageから状態を読む。破損・欠損・未知schema_versionは空状態にフォールバックする(例外を投げない)。 */
export function loadState(): LoadStateResult {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: emptyState(), degraded: false };
    const parsed = parseAppState(raw);
    if (parsed) return { state: parsed, degraded: false };
    return { state: emptyState(), degraded: true };
  } catch {
    // 壊れたJSON等。既存データは触らず、アプリは空状態から動作を継続する。
    return { state: emptyState(), degraded: true };
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
