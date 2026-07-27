// 増分5: 決算接近・高値接近/更新・損切り接近の判定(決定論、純関数)。
// 契約: docs/design.md 増分5節。保存はしない(呼び出しのたびに毎回計算する)。
// 対象は「今日judgmentが必要な変化」なので、状態がcandidate/watching/holdingの銘柄のみを対象にする
// (sold/passedは判断が済んだ銘柄として今日の判断キューの対象外とする。この増分の実装判断)。

import { Ticker, TickerStatus, Trade } from "../types";
import { EarningsScheduleEntry, PriceSeries } from "./pipeline";
import { computePosition } from "./position";
import { daysBetween } from "./date";

export type EventKind = "earnings" | "high" | "stop";

export interface JudgmentEvent {
  id: string;
  kind: EventKind;
  tickerId: string;
  tickerName: string;
  /** 表示ラベル(例: "決算接近" "高値更新" "損切りライン割れ")。 */
  label: string;
  /** 根拠数値の説明文。 */
  detail: string;
  /** 根拠となったデータの日付(YYYY-MM-DD)。 */
  dataDate: string;
}

const ACTIVE_STATUSES: ReadonlySet<TickerStatus> = new Set<TickerStatus>(["candidate", "watching", "holding"]);

/** 銘柄IDを市場プレフィックスとコードに分ける。"JP:7203" -> ["JP", "7203"] */
function splitId(id: string): [string, string] {
  const idx = id.indexOf(":");
  if (idx === -1) return ["", id];
  return [id.slice(0, idx), id.slice(idx + 1)];
}

function lastNonNull(dates: string[], closes: (number | null)[]): { value: number; date: string } | null {
  for (let i = closes.length - 1; i >= 0; i--) {
    const v = closes[i];
    if (v !== null && Number.isFinite(v)) return { value: v, date: dates[i] };
  }
  return null;
}

/** シリーズの「最新値」。日次の最新close優先、無ければ週次の最新closeにフォールバックする。 */
export function latestClose(series: PriceSeries): { value: number; date: string } | null {
  return lastNonNull(series.daily.dates, series.daily.close) ?? lastNonNull(series.weekly.dates, series.weekly.close);
}

/**
 * 週次3年分の確定高値(nullを除いた最大値)。境界の定義: `weekly.close`の末尾1件
 * (=進行中の週の足)は母集団から除外する。進行中週のcloseは日次の最新closeと同一値に
 * なりうるため、除外しないと最新値が常に基準値以下になり「高値更新」が構造的に発火しない
 * (reviewer重大3)。高値接近(95%以上)判定もこの関数を共有しているため同じ基準になる。
 * 有効な値が無ければnull。
 */
export function weeklyHigh(series: PriceSeries): number | null {
  let max: number | null = null;
  const confirmedWeeks = series.weekly.close.slice(0, -1);
  for (const v of confirmedWeeks) {
    if (v === null || !Number.isFinite(v)) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

/** (a) 決算接近: 登録銘柄(JP・アクティブ状態)の決算発表予定日が今日から7日以内(当日含む)。 */
export function detectEarningsEvents(
  tickers: Ticker[],
  schedule: EarningsScheduleEntry[],
  today: string,
): JudgmentEvent[] {
  const byCode = new Map<string, EarningsScheduleEntry>();
  for (const s of schedule) {
    const existing = byCode.get(s.code);
    // 同一コードが複数件ある場合は日付が最も近いものを優先する。
    if (!existing || s.date < existing.date) byCode.set(s.code, s);
  }

  const events: JudgmentEvent[] = [];
  for (const t of tickers) {
    if (!ACTIVE_STATUSES.has(t.status)) continue;
    const [market, code] = splitId(t.id);
    if (market !== "JP") continue;
    const entry = byCode.get(code);
    if (!entry) continue;
    const diff = daysBetween(today, entry.date);
    if (diff < 0 || diff > 7) continue;
    const daysLabel = diff === 0 ? "本日" : `あと${diff}日`;
    events.push({
      id: `${t.id}:earnings`,
      kind: "earnings",
      tickerId: t.id,
      tickerName: t.name,
      label: "決算接近",
      detail: `決算発表予定: ${entry.date}(${daysLabel})`,
      dataDate: entry.date,
    });
  }
  return events;
}

/** (b) 高値接近/更新: 週次3年高値に対し最新値が95%以上=接近、超えたら更新。 */
export function detectHighEvents(tickers: Ticker[], prices: Map<string, PriceSeries>): JudgmentEvent[] {
  const events: JudgmentEvent[] = [];
  for (const t of tickers) {
    if (!ACTIVE_STATUSES.has(t.status)) continue;
    const [market, code] = splitId(t.id);
    if (market !== "JP") continue;
    const series = prices.get(code);
    if (!series) continue;
    const latest = latestClose(series);
    const high = weeklyHigh(series);
    if (!latest || high === null || high <= 0) continue;
    const ratio = latest.value / high;
    if (ratio > 1) {
      events.push({
        id: `${t.id}:high`,
        kind: "high",
        tickerId: t.id,
        tickerName: t.name,
        label: "高値更新",
        detail: `最新値 ${latest.value.toLocaleString()} が3年高値 ${high.toLocaleString()} を更新`,
        dataDate: latest.date,
      });
    } else if (ratio >= 0.95) {
      const remaining = (1 - ratio) * 100;
      events.push({
        id: `${t.id}:high`,
        kind: "high",
        tickerId: t.id,
        tickerName: t.name,
        label: "高値接近",
        detail: `3年高値 ${high.toLocaleString()} まで残り${remaining.toFixed(1)}%(最新値 ${latest.value.toLocaleString()})`,
        dataDate: latest.date,
      });
    }
  }
  return events;
}

/** (c) 損切り接近: 保有銘柄の最新株価がstopの103%以下=接近、下回ったら割れ。 */
export function detectStopEvents(
  tickers: Ticker[],
  trades: Trade[],
  prices: Map<string, PriceSeries>,
): JudgmentEvent[] {
  const events: JudgmentEvent[] = [];
  for (const t of tickers) {
    if (t.status !== "holding") continue;
    const [market, code] = splitId(t.id);
    if (market !== "JP") continue;
    const position = computePosition(trades, t.id);
    if (position.qty <= 0 || position.currentStop === null) continue;
    const series = prices.get(code);
    if (!series) continue;
    const latest = latestClose(series);
    if (!latest) continue;
    const stop = position.currentStop;
    if (latest.value < stop) {
      events.push({
        id: `${t.id}:stop`,
        kind: "stop",
        tickerId: t.id,
        tickerName: t.name,
        label: "損切りライン割れ",
        detail: `最新値 ${latest.value.toLocaleString()} が損切りライン ${stop.toLocaleString()} を割れ`,
        dataDate: latest.date,
      });
    } else if (latest.value <= stop * 1.03) {
      events.push({
        id: `${t.id}:stop`,
        kind: "stop",
        tickerId: t.id,
        tickerName: t.name,
        label: "損切りライン接近",
        detail: `最新値 ${latest.value.toLocaleString()} が損切りライン ${stop.toLocaleString()} の103%以下`,
        dataDate: latest.date,
      });
    }
  }
  return events;
}

const KIND_ORDER: Record<EventKind, number> = { stop: 0, earnings: 1, high: 2 };

/** 3種のイベントを統合し、種別(損切り→決算→高値)→銘柄名の順で安定ソートする。 */
export function buildJudgmentQueue(
  tickers: Ticker[],
  trades: Trade[],
  schedule: EarningsScheduleEntry[] | null,
  prices: Map<string, PriceSeries>,
  today: string,
): JudgmentEvent[] {
  const events: JudgmentEvent[] = [
    ...detectStopEvents(tickers, trades, prices),
    ...(schedule ? detectEarningsEvents(tickers, schedule, today) : []),
    ...detectHighEvents(tickers, prices),
  ];
  return events.sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.tickerName < b.tickerName ? -1 : a.tickerName > b.tickerName ? 1 : 0;
  });
}
