import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AppSettings, AppStateV1, Market, PassReasonTag, Ticker, TickerStatus, CURRENCY_BY_MARKET, Trade, TradeInput } from "./types";
import { loadState, saveState } from "./lib/storage";
import { nowStr, todayStr } from "./lib/date";
import { useHashRoute } from "./lib/router";
import { ImportCandidate } from "./lib/external";
import { computePosition } from "./lib/position";
import { loadPipelineData, PipelineData } from "./lib/pipeline";
import { buildJudgmentQueue } from "./lib/events";
import {
  hasToken,
  pull,
  push,
  resolveConflictAdoptRemote,
  resolveConflictKeepLocal,
  SyncOutcome,
  SyncPhase,
} from "./lib/sync";
import { TodayQueue } from "./components/TodayQueue";
import { AddTickerForm } from "./components/AddTickerForm";
import { TickerDetail } from "./components/TickerDetail";
import { ImportPage } from "./components/ImportPage";
import { SettingsPage } from "./components/SettingsPage";
import { SyncIndicator } from "./components/SyncIndicator";
import { ConflictDialog } from "./components/ConflictDialog";
import { PassDialog } from "./components/PassDialog";

/** append-onlyの見送り履歴の上限(増分7、docs/design.md 増分7節)。超過分は古いものから削除する。 */
const MAX_PASSED_EVENTS = 20;

/** private repo同期のデバウンス間隔(mutation後3秒。docs/design.md 増分4節)。 */
const PUSH_DEBOUNCE_MS = 3000;

/** 取引IDの採番。crypto.randomUUID未対応環境(古いiOS Safari等)向けにフォールバックを持つ。 */
function genTradeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function App() {
  // reviewer中5: loadStateがlocalStorage破損から空状態へフォールバックした(degraded)場合、
  // このrefで起動時pullへ伝え、自動push/自動採用を安全側(競合ダイアログ)に倒す。
  // 起動時pullが一度完了すればfalseにリセットする(以降の編集は正規のユーザー操作のため)。
  const degradedRef = useRef(false);
  const [state, setState] = useState<AppStateV1>(() => {
    const loaded = loadState();
    degradedRef.current = loaded.degraded;
    return loaded.state;
  });
  const isFirstRender = useRef(true);
  const route = useHashRoute();

  // pull/push実行中(非同期)にローカル編集が入ったかどうかを判定するため、常に最新のstateを
  // 参照できるref(Codex P1)。pull()呼び出し時点のstateスナップショットと比較する。
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // private repo同期(増分4)の表示状態。トークン未設定なら常にunset。
  const [syncPhase, setSyncPhase] = useState<SyncPhase>(() => (hasToken() ? "idle" : "unset"));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ remoteState: AppStateV1; sha: string } | null>(null);

  // 見送りワンタップ(増分7): カルテ画面・今日の判断キューの両方から同じダイアログを開く対象の
  // tickerIdを保持する。nullなら非表示。
  const [passTarget, setPassTarget] = useState<string | null>(null);

  // 増分5: 決算ナビ・需給ナビの公開JSONから決定論イベント(今日の判断キュー)を作るための入力データ。
  // 未取得(pipeline===null)は起動直後の初回fetch待ち。
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const jpCodesKey = useMemo(() => {
    const codes = state.tickers.filter((t) => t.id.startsWith("JP:")).map((t) => t.id.slice(3));
    return Array.from(new Set(codes)).sort().join(",");
  }, [state.tickers]);

  useEffect(() => {
    let cancelled = false;
    const codes = jpCodesKey === "" ? [] : jpCodesKey.split(",");
    loadPipelineData(codes).then((data) => {
      if (!cancelled) setPipeline(data);
    });
    return () => {
      cancelled = true;
    };
  }, [jpCodesKey]);

  const today = todayStr();
  const judgmentEvents = useMemo(
    () =>
      pipeline
        ? buildJudgmentQueue(state.tickers, state.trades ?? [], pipeline.schedule, pipeline.prices, today)
        : [],
    [pipeline, state.tickers, state.trades, today],
  );

  // 同期結果でstateを書き換えたとき(remote採用)は、その書き換え自体をpushのトリガーにしない
  // ためのフラグ(直後のuseEffectで一度だけ消費する)。
  const skipNextPushRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * pull/push/競合解決の結果をUI状態(state・syncPhase・conflict)へ反映する共通処理。
   * `requestState`は今回のpull/push呼び出しに渡した(=リクエスト開始時点の)stateスナップショット。
   * 非同期処理中にユーザーがローカルを編集していれば`stateRef.current`(最新state)と食い違うため、
   * "adopt-remote"を黙って適用せず競合ダイアログへ回し、進行中のローカル編集を消さないようにする
   * (Codex P1)。
   */
  function applySyncOutcome(outcome: SyncOutcome, requestState: AppStateV1) {
    switch (outcome.kind) {
      case "no-token":
        setSyncPhase("unset");
        setSyncError(null);
        return;
      case "in-sync":
      case "pushed":
      case "created":
        setSyncPhase("synced");
        setSyncError(null);
        return;
      case "adopt-remote":
        if (stateRef.current.lastModified !== requestState.lastModified) {
          // pull実行中にローカルが変わった。remoteを無告知採用せず競合ダイアログへ回す。
          setConflict({ remoteState: outcome.remoteState, sha: outcome.sha });
          setSyncPhase("idle");
          return;
        }
        skipNextPushRef.current = true;
        setState(resolveConflictAdoptRemote(outcome.remoteState, outcome.sha));
        setSyncPhase("synced");
        setSyncError(null);
        return;
      case "conflict":
        setConflict({ remoteState: outcome.remoteState, sha: outcome.sha });
        setSyncPhase("idle");
        return;
      case "error":
        setSyncPhase("error");
        setSyncError(outcome.message);
        return;
    }
  }

  // 起動時pull(docs/design.md 増分4節)。トークン未設定なら何もしない(sync.ts側もno-tokenを返すが、
  // 通信自体をここで避ける)。マウント時の1回だけ実行する。
  useEffect(() => {
    if (!hasToken()) return;
    setSyncPhase("syncing");
    pull(state, 0, { localDegraded: degradedRef.current })
      .then((outcome) => {
        // この起動時pull(成功・失敗いずれか)が一度完了すれば、以降のstateは正規のユーザー
        // 操作によるものとして扱う(degradedガードは初回のみ)。
        degradedRef.current = false;
        applySyncOutcome(outcome, state);
      })
      .catch((e: unknown) => {
        degradedRef.current = false;
        setSyncPhase("error");
        setSyncError(e instanceof Error ? e.message : "同期エラー");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 変更のたびにlocalStorageへ保存する。初回マウント時はスキップする: loadStateの寛容パース結果
  // (破損データのフォールバック等)をユーザー操作なしに書き戻さない(docs/design.md (b) の契約)。
  // トークン設定時は、保存に続けて3秒デバウンスでpushする(docs/design.md 増分4節)。
  // 同期結果によるstate書き換え(remote採用)自体はpushの起点にしない(skipNextPushRef)。
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveState(state);
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }
    if (!hasToken()) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      setSyncPhase("syncing");
      push(state)
        .then((outcome) => applySyncOutcome(outcome, state))
        .catch((e: unknown) => {
          setSyncPhase("error");
          setSyncError(e instanceof Error ? e.message : "同期エラー");
        });
    }, PUSH_DEBOUNCE_MS);
    return () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleTokenChanged() {
    setSyncError(null);
    if (hasToken()) {
      setSyncPhase("syncing");
      pull(state)
        .then((outcome) => applySyncOutcome(outcome, state))
        .catch((e: unknown) => {
          setSyncPhase("error");
          setSyncError(e instanceof Error ? e.message : "同期エラー");
        });
    } else {
      setSyncPhase("unset");
    }
  }

  function handleSyncNow() {
    setSyncPhase("syncing");
    pull(state)
      .then((outcome) => applySyncOutcome(outcome, state))
      .catch((e: unknown) => {
        setSyncPhase("error");
        setSyncError(e instanceof Error ? e.message : "同期エラー");
      });
  }

  function handleAdoptRemote() {
    if (!conflict) return;
    skipNextPushRef.current = true;
    setState(resolveConflictAdoptRemote(conflict.remoteState, conflict.sha));
    setConflict(null);
    setSyncPhase("synced");
    setSyncError(null);
  }

  function handleKeepLocal() {
    if (!conflict) return;
    const remoteSha = conflict.sha;
    const requestState = state;
    setSyncPhase("syncing");
    resolveConflictKeepLocal(state, remoteSha)
      .then((outcome) => {
        setConflict(null);
        applySyncOutcome(outcome, requestState);
      })
      .catch((e: unknown) => {
        setConflict(null);
        setSyncPhase("error");
        setSyncError(e instanceof Error ? e.message : "同期エラー");
      });
  }

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
    setState((prev) => ({ ...prev, tickers: [...prev.tickers, ticker], lastModified: now }));
    return null;
  }

  function handleStatusChange(id: string, status: TickerStatus) {
    const now = nowStr();
    setState((prev) => ({
      ...prev,
      tickers: prev.tickers.map((t) => (t.id === id ? { ...t, status, updatedAt: now } : t)),
      lastModified: now,
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
      setState((prev) => ({ ...prev, tickers: [...prev.tickers, ...additions], lastModified: now }));
    }
    return { imported: additions.length, skipped };
  }

  // 取引記録(増分3): 追加時に建玉を再計算し、買いで保有>0になれば holding、
  // 売りで保有が0になれば sold へ自動遷移する(docs/design.md 増分3節)。
  function handleAddTrade(input: TradeInput) {
    const now = nowStr();
    const trade: Trade = { ...input, id: genTradeId(), createdAt: now };
    setState((prev) => {
      const trades = [...(prev.trades ?? []), trade];
      const position = computePosition(trades, input.tickerId);
      const tickers = prev.tickers.map((t) => {
        if (t.id !== input.tickerId) return t;
        let status = t.status;
        if (input.side === "buy" && position.qty > 0) status = "holding";
        if (input.side === "sell" && position.qty === 0) status = "sold";
        if (status === t.status) return t;
        return { ...t, status, updatedAt: now };
      });
      return { ...prev, trades, tickers, lastModified: now };
    });
  }

  function handleDeleteTrade(tradeId: string) {
    const now = nowStr();
    setState((prev) => ({
      ...prev,
      trades: (prev.trades ?? []).filter((t) => t.id !== tradeId),
      lastModified: now,
    }));
  }

  // 見送りワンタップ(増分7): カルテの「見送る」・今日の判断キューの各カードの「見送る」の
  // 両方から呼ぶ共通導線。ダイアログでタグ確定後にstatus=passed+passedEvents追記する。
  function handleOpenPass(tickerId: string) {
    setPassTarget(tickerId);
  }

  function handleCancelPass() {
    setPassTarget(null);
  }

  function handleConfirmPass(tags: PassReasonTag[]) {
    if (!passTarget) return;
    const targetId = passTarget;
    const now = nowStr();
    const today = todayStr();
    setState((prev) => ({
      ...prev,
      tickers: prev.tickers.map((t) => {
        if (t.id !== targetId) return t;
        const events = [...(t.passedEvents ?? []), { date: today, tags }];
        // append-only上限20件。超過分は古いものから削除する(docs/design.md 増分7節)。
        const passedEvents =
          events.length > MAX_PASSED_EVENTS ? events.slice(events.length - MAX_PASSED_EVENTS) : events;
        return { ...t, status: "passed" as const, passedEvents, updatedAt: now };
      }),
      lastModified: now,
    }));
    setPassTarget(null);
  }

  function handleSettingsChange(next: AppSettings) {
    const now = nowStr();
    setState((prev) => ({ ...prev, settings: next, lastModified: now }));
  }

  return (
    <div class="app">
      <header class="app__header">
        <div class="app__header-row">
          <h1>投資航路</h1>
          <SyncIndicator phase={syncPhase} error={syncError} />
        </div>
        <p class="app__tagline">今日の判断キュー</p>
      </header>
      <main>
        {route.name === "today" && (
          <>
            <TodayQueue
              tickers={state.tickers}
              trades={state.trades ?? []}
              onStatusChange={handleStatusChange}
              events={judgmentEvents}
              kessanAsOf={pipeline?.kessanAsOf ?? null}
              jukyuAsOf={pipeline?.jukyuAsOf ?? null}
              kessanError={pipeline ? pipeline.errors.kessan : false}
              jukyuError={pipeline ? pipeline.errors.jukyu : false}
              pipelineLoading={pipeline === null}
              today={today}
              onOpenPass={handleOpenPass}
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
            prices={pipeline?.prices ?? new Map()}
            settings={state.settings}
            onOpenPass={handleOpenPass}
          />
        )}
        {route.name === "import" && (
          <ImportPage
            existingIds={new Set(state.tickers.map((t) => t.id))}
            onImport={handleImport}
          />
        )}
        {route.name === "settings" && (
          <SettingsPage
            syncPhase={syncPhase}
            syncError={syncError}
            onTokenChanged={handleTokenChanged}
            onSyncNow={handleSyncNow}
            settings={state.settings}
            onSettingsChange={handleSettingsChange}
          />
        )}
      </main>
      {conflict && (
        <ConflictDialog
          remoteState={conflict.remoteState}
          onAdoptRemote={handleAdoptRemote}
          onKeepLocal={handleKeepLocal}
        />
      )}
      {passTarget && (
        <PassDialog
          tickerName={state.tickers.find((t) => t.id === passTarget)?.name ?? passTarget}
          onConfirm={handleConfirmPass}
          onCancel={handleCancelPass}
        />
      )}
    </div>
  );
}
