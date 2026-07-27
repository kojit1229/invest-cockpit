import { useEffect, useRef, useState } from "preact/hooks";
import { AppStateV1, Market, Ticker, TickerStatus, CURRENCY_BY_MARKET } from "./types";
import { loadState, saveState } from "./lib/storage";
import { nowStr } from "./lib/date";
import { TodayQueue } from "./components/TodayQueue";
import { AddTickerForm } from "./components/AddTickerForm";

export function App() {
  const [state, setState] = useState<AppStateV1>(() => loadState());
  const isFirstRender = useRef(true);

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

  return (
    <div class="app">
      <header class="app__header">
        <h1>投資航路</h1>
        <p class="app__tagline">今日の判断キュー</p>
      </header>
      <main>
        <TodayQueue tickers={state.tickers} onStatusChange={handleStatusChange} />
        <AddTickerForm onAdd={handleAdd} />
      </main>
    </div>
  );
}
