// 旧アプリ(需給ナビ / 決算ナビ)のlocalStorageを読むだけのアダプタ(増分2)。
// 書き込みは一切行わない。GitHub Pagesでは同一オリジン(kojit1229.github.io)のため
// 直接localStorageを読める(design.md 増分2の調査結果を参照)。
//
// 注意: 両アプリのlocalStorageには銘柄コードのみが保存されており、銘柄名は
// 保存されていない(名称は各アプリがdata/*.jsonから都度引いて表示している)。
// このためインポート候補の名称はコードそのものを暫定値として使う。

export type ImportSource = "jukyu-navi" | "kessan-navi";

export interface ImportCandidate {
  /** "JP:<code>" 形式のticker ID */
  id: string;
  code: string;
  /** localStorageに名称が無いため暫定的にcodeを入れる */
  name: string;
  source: ImportSource;
  sourceLabel: string;
}

export interface ImportSourceResult {
  source: ImportSource;
  label: string;
  candidates: ImportCandidate[];
  /** 読み込み失敗(データ形式不正)。空(未登録)とは区別する。 */
  error: boolean;
}

const JUKYU_WATCHLIST_KEY = "jukyu_watchlist_v1";
const KESSAN_LOCAL_KEY = "kessan_local_v1";

function readJukyuWatchlist(): ImportSourceResult {
  const source: ImportSource = "jukyu-navi";
  const label = "需給ナビ";
  try {
    const raw = window.localStorage.getItem(JUKYU_WATCHLIST_KEY);
    if (!raw) return { source, label, candidates: [], error: false };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { source, label, candidates: [], error: true };
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.codes)) {
      return { source, label, candidates: [], error: true };
    }
    const codes = obj.codes.filter((c): c is string => typeof c === "string" && c.length > 0);
    const candidates: ImportCandidate[] = codes.map((code) => ({
      id: `JP:${code}`,
      code,
      name: code,
      source,
      sourceLabel: label,
    }));
    return { source, label, candidates, error: false };
  } catch {
    return { source, label, candidates: [], error: true };
  }
}

function readKessanMyStocks(): ImportSourceResult {
  const source: ImportSource = "kessan-navi";
  const label = "決算ナビ";
  try {
    const raw = window.localStorage.getItem(KESSAN_LOCAL_KEY);
    if (!raw) return { source, label, candidates: [], error: false };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { source, label, candidates: [], error: true };
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.mystocks)) {
      return { source, label, candidates: [], error: true };
    }
    const candidates: ImportCandidate[] = [];
    for (const m of obj.mystocks) {
      if (typeof m !== "object" || m === null) continue;
      const code = (m as Record<string, unknown>).code;
      if (typeof code !== "string" || !code) continue;
      candidates.push({ id: `JP:${code}`, code, name: code, source, sourceLabel: label });
    }
    return { source, label, candidates, error: false };
  } catch {
    return { source, label, candidates: [], error: true };
  }
}

export function readImportSources(): ImportSourceResult[] {
  return [readJukyuWatchlist(), readKessanMyStocks()];
}

// 深掘りリンク(JP銘柄のみ。事実として確認済みのURL形式。docs/design.md 増分2の調査結果を参照)
export function kessanNaviUrl(code: string): string {
  return `https://kojit1229.github.io/stock_analyze/#/stock/${encodeURIComponent(code)}`;
}

export function jukyuNaviUrl(code: string): string {
  return `https://kojit1229.github.io/stock_supply_demand/#/issue/${encodeURIComponent(code)}`;
}
