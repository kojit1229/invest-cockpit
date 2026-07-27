// 増分8: 需給ドーナツ(売り圧vs買い圧)。契約はdocs/design.md (j)節。
// 需給ナビ(repos/stock_supply_demand、gh-pages配信)のJSDA週次貸借・JPX機関投資家空売り報告・
// 日証金日次貸借の3ソースから、対象コード1件分だけをその都度fetchして集計する(保存はしない)。
// ソースごとに独立してfetch・失敗を隔離する(pipeline.tsと同じ方針)。

import { fetchJson } from "./pipeline";
import { subtractDays } from "./date";

/** 需給ドーナツの1セグメント(凡例1行分)。 */
export interface SupplyDemandSegment {
  key: string;
  label: string;
  /** 単位: 株。 */
  qty: number;
  /** このセグメントが実際に参照したデータの日付("YYYY-MM-DD")。 */
  asOf: string;
  /** 比較期間の差分(株)。比較対象が取得できなければnull(凡例は矢印を出さない)。 */
  diff: number | null;
  diffPeriod: "week" | "day";
}

export type SupplyDemandSourceKey = "jsda" | "jpx_short" | "jsf";

export interface SupplyDemandSourceError {
  source: SupplyDemandSourceKey;
  label: string;
}

export interface SupplyDemandResult {
  buy: SupplyDemandSegment[];
  sell: SupplyDemandSegment[];
  errors: SupplyDemandSourceError[];
}

const JSDA_META_URL = "/stock_supply_demand/data/meta.json";
function jsdaWeeklyUrl(reportDate: string): string {
  return `/stock_supply_demand/data/weekly/${reportDate}.json`;
}

const JPX_SHORT_META_URL = "/stock_supply_demand/data/short_meta.json";
function jpxShortShardUrl(code: string): string {
  return `/stock_supply_demand/data/short/${encodeURIComponent(code.slice(0, 2))}.json`;
}

const JSF_META_URL = "/stock_supply_demand/data/taishaku_meta.json";
function jsfSnapshotUrl(applyDate: string): string {
  return `/stock_supply_demand/data/taishaku/${applyDate}.json`;
}

// --- 検証(寛容パース。型だけでなく、参照する数値フィールドが数値であることまで見る) ---

interface JsdaMeasurement {
  lend_qty: number;
}

function isValidMeasurement(v: unknown): v is JsdaMeasurement {
  if (typeof v !== "object" || v === null) return false;
  return Number.isFinite((v as Record<string, unknown>).lend_qty);
}

/** weekly/{date}.jsonの対象コードのlend_qty合計(yutanpo+mutanpo)。コード自体が無ければnull。 */
function sumJsdaLendQty(weeklyRaw: unknown, code: string): number | null {
  if (typeof weeklyRaw !== "object" || weeklyRaw === null) return null;
  const issues = (weeklyRaw as Record<string, unknown>).issues;
  if (typeof issues !== "object" || issues === null) return null;
  const issue = (issues as Record<string, unknown>)[code];
  if (typeof issue !== "object" || issue === null) return null;
  const taishaku = (issue as Record<string, unknown>).taishaku;
  if (typeof taishaku !== "object" || taishaku === null) return null;
  const t = taishaku as Record<string, unknown>;
  const yutanpo = isValidMeasurement(t.yutanpo) ? t.yutanpo.lend_qty : 0;
  const mutanpo = isValidMeasurement(t.mutanpo) ? t.mutanpo.lend_qty : 0;
  if (t.yutanpo === undefined && t.mutanpo === undefined) return null;
  return yutanpo + mutanpo;
}

interface JsfIssueFields {
  yushi_zan: number;
  kashikabu_zan: number;
}

function readJsfIssue(snapshotRaw: unknown, code: string): JsfIssueFields | null {
  if (typeof snapshotRaw !== "object" || snapshotRaw === null) return null;
  const issues = (snapshotRaw as Record<string, unknown>).issues;
  if (typeof issues !== "object" || issues === null) return null;
  const issue = (issues as Record<string, unknown>)[code];
  if (typeof issue !== "object" || issue === null) return null;
  const o = issue as Record<string, unknown>;
  if (!Number.isFinite(o.yushi_zan) || !Number.isFinite(o.kashikabu_zan)) return null;
  return { yushi_zan: o.yushi_zan as number, kashikabu_zan: o.kashikabu_zan as number };
}

interface ShortEvent {
  date: string;
  qty: number;
  seller: string;
}

function isValidShortEvent(v: unknown): v is ShortEvent {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.date === "string" && Number.isFinite(o.qty) && typeof o.seller === "string";
}

function readShortEvents(shardRaw: unknown, code: string): ShortEvent[] | null {
  if (typeof shardRaw !== "object" || shardRaw === null) return null;
  const issues = (shardRaw as Record<string, unknown>).issues;
  if (typeof issues !== "object" || issues === null) return null;
  const issue = (issues as Record<string, unknown>)[code];
  if (typeof issue !== "object" || issue === null) return null;
  const events = (issue as Record<string, unknown>).events;
  if (!Array.isArray(events)) return null;
  return events.filter(isValidShortEvent);
}

/** 報告者(seller)ごとに、指定日以前の最新eventを1件選び、qty>0(まだ有効)の合計を返す。 */
function sumActiveShortQty(events: ShortEvent[], onOrBefore: string): number {
  const latestBySeller = new Map<string, ShortEvent>();
  for (const e of events) {
    if (e.date > onOrBefore) continue;
    const current = latestBySeller.get(e.seller);
    if (!current || e.date > current.date) latestBySeller.set(e.seller, e);
  }
  let total = 0;
  for (const e of latestBySeller.values()) {
    if (e.qty > 0) total += e.qty;
  }
  return total;
}

async function loadJsdaSegment(code: string): Promise<{ segment: SupplyDemandSegment | null; error: boolean }> {
  const metaRaw = await fetchJson(JSDA_META_URL);
  if (typeof metaRaw !== "object" || metaRaw === null) return { segment: null, error: true };
  const latestWeek = (metaRaw as Record<string, unknown>).latest_week;
  if (typeof latestWeek !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(latestWeek)) {
    return { segment: null, error: true };
  }

  const currentRaw = await fetchJson(jsdaWeeklyUrl(latestWeek));
  if (currentRaw === null) return { segment: null, error: true };

  const currentLendQty = sumJsdaLendQty(currentRaw, code);
  if (currentLendQty === null) return { segment: null, error: false };

  // 前週比: 7日前を優先し、祝日ズレ(木曜報告週)に備え6日前・8日前も試す。全滅ならdiff無し。
  let diff: number | null = null;
  for (const offset of [7, 6, 8]) {
    const candidateDate = subtractDays(latestWeek, offset);
    const priorRaw = await fetchJson(jsdaWeeklyUrl(candidateDate));
    if (priorRaw !== null) {
      const priorLendQty = sumJsdaLendQty(priorRaw, code);
      if (priorLendQty !== null) diff = currentLendQty - priorLendQty;
      break;
    }
  }

  return {
    segment: {
      key: "jsda_lend",
      label: "借株需要(代理: JSDA貸付残高)",
      qty: currentLendQty,
      asOf: latestWeek,
      diff,
      diffPeriod: "week",
    },
    error: false,
  };
}

async function loadJsfSegments(
  code: string,
): Promise<{ buy: SupplyDemandSegment | null; sell: SupplyDemandSegment | null; error: boolean }> {
  const metaRaw = await fetchJson(JSF_META_URL);
  if (typeof metaRaw !== "object" || metaRaw === null) return { buy: null, sell: null, error: true };
  const latestApplyDate = (metaRaw as Record<string, unknown>).latest_apply_date;
  if (typeof latestApplyDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(latestApplyDate)) {
    return { buy: null, sell: null, error: true };
  }

  const currentRaw = await fetchJson(jsfSnapshotUrl(latestApplyDate));
  if (currentRaw === null) return { buy: null, sell: null, error: true };

  const current = readJsfIssue(currentRaw, code);
  if (current === null) return { buy: null, sell: null, error: false };

  // 前日比: 週末・祝日をスキップするため1〜4日前の順で最初に取れたスナップショットと比較する。
  let yushiDiff: number | null = null;
  let kashikabuDiff: number | null = null;
  for (const offset of [1, 2, 3, 4]) {
    const candidateDate = subtractDays(latestApplyDate, offset);
    const priorRaw = await fetchJson(jsfSnapshotUrl(candidateDate));
    if (priorRaw !== null) {
      const prior = readJsfIssue(priorRaw, code);
      if (prior !== null) {
        yushiDiff = current.yushi_zan - prior.yushi_zan;
        kashikabuDiff = current.kashikabu_zan - prior.kashikabu_zan;
      }
      break;
    }
  }

  return {
    buy: {
      key: "jsf_yushi",
      label: "信用買い残(代理: 日証金融資残高)",
      qty: current.yushi_zan,
      asOf: latestApplyDate,
      diff: yushiDiff,
      diffPeriod: "day",
    },
    sell: {
      key: "jsf_kashikabu",
      label: "信用売り残(代理: 日証金貸株残高)",
      qty: current.kashikabu_zan,
      asOf: latestApplyDate,
      diff: kashikabuDiff,
      diffPeriod: "day",
    },
    error: false,
  };
}

async function loadJpxShortSegment(code: string): Promise<{ segment: SupplyDemandSegment | null; error: boolean }> {
  const metaRaw = await fetchJson(JPX_SHORT_META_URL);
  if (typeof metaRaw !== "object" || metaRaw === null) return { segment: null, error: true };
  const latestShortDate = (metaRaw as Record<string, unknown>).latest_short_date;
  if (typeof latestShortDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(latestShortDate)) {
    return { segment: null, error: true };
  }

  // シャード404は「このプレフィックスに空売り報告銘柄が無い」正常系(docs/design.md (j)節)。
  const shardRaw = await fetchJson(jpxShortShardUrl(code));
  const events = shardRaw === null ? null : readShortEvents(shardRaw, code);
  if (events === null || events.length === 0) return { segment: null, error: false };

  const currentQty = sumActiveShortQty(events, latestShortDate);
  const weekAgoQty = sumActiveShortQty(events, subtractDays(latestShortDate, 7));

  return {
    segment: {
      key: "jpx_short",
      label: "機関投資家空売り報告 合計",
      qty: currentQty,
      asOf: latestShortDate,
      diff: currentQty - weekAgoQty,
      diffPeriod: "week",
    },
    error: false,
  };
}

/** 需給ドーナツ用データを1コード分ロードする。3ソースは並行・独立して失敗を隔離する。 */
export async function loadSupplyDemandData(code: string): Promise<SupplyDemandResult> {
  const [jsda, jsf, jpxShort] = await Promise.all([
    loadJsdaSegment(code),
    loadJsfSegments(code),
    loadJpxShortSegment(code),
  ]);

  const buy: SupplyDemandSegment[] = [];
  if (jsf.buy) buy.push(jsf.buy);

  const sell: SupplyDemandSegment[] = [];
  if (jsda.segment) sell.push(jsda.segment);
  if (jpxShort.segment) sell.push(jpxShort.segment);
  if (jsf.sell) sell.push(jsf.sell);

  const errors: SupplyDemandSourceError[] = [];
  if (jsda.error) errors.push({ source: "jsda", label: "JSDA週次貸借" });
  if (jpxShort.error) errors.push({ source: "jpx_short", label: "JPX機関投資家空売り報告" });
  if (jsf.error) errors.push({ source: "jsf", label: "日証金日次貸借" });

  return { buy, sell, errors };
}

export type SupplyDemandJudgment = "buy-dominant" | "sell-dominant" | "neutral" | "no-data";

export const JUDGMENT_LABEL_JA: Record<SupplyDemandJudgment, string> = {
  "buy-dominant": "買い優勢",
  "sell-dominant": "売り優勢",
  neutral: "中立",
  "no-data": "データ不足",
};

/**
 * 買い合計÷売り合計の倍率で単純判定する(既存needs需給ナビsignals.jsonは実在しないため常にこの経路、
 * docs/design.md (j)節)。>1.5買い優勢、<0.7売り優勢、それ以外は中立。0除算はbuy-dominant/no-dataに丸める。
 */
export function classifySupplyDemand(buyTotal: number, sellTotal: number): SupplyDemandJudgment {
  if (buyTotal <= 0 && sellTotal <= 0) return "no-data";
  if (sellTotal <= 0) return "buy-dominant";
  if (buyTotal <= 0) return "sell-dominant";
  const ratio = buyTotal / sellTotal;
  if (ratio > 1.5) return "buy-dominant";
  if (ratio < 0.7) return "sell-dominant";
  return "neutral";
}

export function sumQty(segments: SupplyDemandSegment[]): number {
  return segments.reduce((acc, s) => acc + s.qty, 0);
}

/** 前週比/前日比の矢印。diff無し(比較データなし)は空文字。 */
export function diffArrow(diff: number | null): string {
  if (diff === null) return "";
  if (diff > 0) return "↑";
  if (diff < 0) return "↓";
  return "→";
}
