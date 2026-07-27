import { useEffect, useRef, useState } from "preact/hooks";
import { AppStateV1, Market, Ticker, TickerStatus, CURRENCY_BY_MARKET, Trade, TradeInput } from "./types";
import { loadState, saveState } from "./lib/storage";
import { nowStr } from "./lib/date";
import { useHashRoute } from "./lib/router";
import { ImportCandidate } from "./lib/external";
import { computePosition } from "./lib/position";
import { TodayQueue } from "./components/TodayQueue";
import { AddTickerForm } from "./components/AddTickerForm";
import { TickerDetail } from "./components/TickerDetail";
import { ImportPage } from "./components/ImportPage";

/** 取引IDの採番。crypto.randomUUID未対応環境(古いiOS Safari等)向けにフォールバックを持つ。 */
function genTradeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function App() {
  const [state, setState] = useState<AppStateV1>(() => loadState());
  const isFirstRender = useRef(true);
  const route = useHashRoute();

  // 変更のたびにlocalStorageへ保存する(この増分は端末内のみ。private repo同期は後続増分)。
  // 初回マウント時はスキップする: loadStateの寛容パース結果(破損データのフォールバック等)を
  // ユーザー操作なしに書き戻さない(docs/design.md (b) の契約)。
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveState(state);
  }, [state]);

  function handleAdd(input: { market: Market; code: string; name: string; status: TickerStatus }): string | null {
    const id = `${input.market}:${input.code}`;
    if (state.tickers.some((t) => t.id === id)) {
      return `${id} は既に登録されています`;
    }
    const now = nowStr();
    const ticker: Ticker = {
      id,
      name: input.name,
      currency: CURRENCY_BY_MARKET[input.market],
      status: input.status,
      createdAt: now,
      updatedAt: now,
    };
    setState((prev) => ({ ...prev, tickers: [...prev.tickers, ticker] }));
    return null;
  }

  function handleStatusChange(id: string, status: TickerStatus) {
    setState((prev) => ({
      ...prev,
      tickers: prev.tickers.map((t) => (t.id === id ? { ...t, status, updatedAt: nowStr() } : t)),
    }));
  }

  // インポート(増分2): 需給ナビ・決算ナビのウォッチリストを一回限り取り込む。
  // 既存IDはスキップする(冪等性はdesign.md (b)のidユニーク制約と同じ)。
  function handleImport(candidates: ImportCandidate[]): { imported: number; skipped: number } {
    const existing = new Set(state.tickers.map((t) => t.id));
    const now = nowStr();
    const additions: Ticker[] = [];
    let skipped = 0;
    for (const c of candidates) {
      if (existing.has(c.id)) {
        skipped++;
        continue;
      }
      existing.add(c.id);
      additions.push({
        id: c.id,
        name: c.name,
        currency: "JPY",
        status: "candidate",
        createdAt: now,
        updatedAt: now,
        importedFrom: c.sourceLabel,
      });
    }
    if (additions.length > 0) {
      setState((prev) => ({ ...prev, tickers: [...prev.tickers, ...additions] }));
    }
    return { imported: additions.length, skipped };
  }

  // 取引記録(増分3): 追加時に建玉を再計算し、買いで保有>0になれば holding、
  // 売りで保有が0になれば sold へ自動遷移する(docs/design.md 増分3節)。
  function handleAddTrade(input: TradeInput) {
    const trade: Trade = { ...input, id: genTradeId(), createdAt: nowStr() };
    setState((prev) => {
      const trades = [...(prev.trades ?? []), trade];
      const position = computePosition(trades, input.tickerId);
      const tickers = prev.tickers.map((t) => {
        if (t.id !== input.tickerId) return t;
        let status = t.status;
        if (input.side === "buy" && position.qty > 0) status = "holding";
        if (input.side === "sell" && position.qty === 0) status = "sold";
        if (status === t.status) return t;
        return { ...t, status, updatedAt: nowStr() };
      });
      return { ...prev, trades, tickers };
    });
  }

  function handleDeleteTrade(tradeId: string) {
    setState((prev) => ({
      ...prev,
      trades: (prev.trades ?? []).filter((t) => t.id !== tradeId),
    }));
  }

  return (
    <div class="app">
      <header class="app__header">
        <h1>投資航路</h1>
        <p class="app__tagline">今日の判断キュー</p>
      </header>
      <main>
        {route.name === "today" && (
          <>
            <TodayQueue
              tickers={state.tickers}
              trades={state.trades ?? []}
              onStatusChange={handleStatusChange}
            />
            <AddTickerForm onAdd={handleAdd} />
            <a class="import-link" href="#/import">
              旧アプリのウォッチリストをインポート
            </a>
          </>
        )}
        {route.name === "ticker" && (
          <TickerDetail
            ticker={state.tickers.find((t) => t.id === route.id)}
            trades={state.trades ?? []}
            onStatusChange={handleStatusChange}
            onAddTrade={handleAddTrade}
            onDeleteTrade={handleDeleteTrade}
          />
        )}
        {route.name === "import" && (
          <ImportPage
            existingIds={new Set(state.tickers.map((t) => t.id))}
            onImport={handleImport}
          />
        )}
      </main>
    </div>
  );
}
