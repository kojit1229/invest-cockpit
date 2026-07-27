// 増分10: personal-dataリポジトリの引け後ブリーフ(invest-cockpit/brief/{YYYY-MM-DD}.json)を
// 読む。契約: docs/design.md 増分10節、batch/brief-validate.pyのスキーマ正典。
// 書き込みは一切行わない(表示専用)。トークン(src/lib/sync.tsと共用のfine-grained PAT)未設定
// なら即座に{ kind: "no-token" }を返し、fetchを一切呼ばない。取得失敗(404含む)は
// アプリの他機能に影響させない(呼び出し側はカードを出さないだけ)。

import { getToken, fromBase64Utf8 } from "./sync";
import { subtractDays } from "./date";

const OWNER = "kojit1229";
const REPO = "personal-data";
const BRANCH = "main";

/** 今日→前日→前々日の順に最大3日分試行する(docs/design.md 増分10節)。 */
const LOOKBACK_DAYS = 2;

export type BriefStance = "反対意見" | "見落とし" | "確認事項";

const VALID_STANCES: ReadonlySet<string> = new Set<BriefStance>(["反対意見", "見落とし", "確認事項"]);

export interface BriefCounterpoint {
  tickerId: string;
  stance: BriefStance;
  text: string;
  basis: string[];
}

export interface Brief {
  schema_version: 1;
  as_of: string;
  generated_at: string;
  generated_by: "ai";
  model: string;
  summary: string;
  counterpoints: BriefCounterpoint[];
  health: { sources: { kessan: boolean; jukyu: boolean; state: boolean } };
}

export type BriefResult =
  | { kind: "no-token" }
  | { kind: "ok"; brief: Brief }
  /** 3日分とも404、または取得・検証に失敗(呼び出し側はカード自体を出さない)。 */
  | { kind: "unavailable" };

function briefUrl(dateStr: string): string {
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/invest-cockpit/brief/${encodeURIComponent(
    dateStr,
  )}.json?ref=${BRANCH}`;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function isValidCounterpoint(v: unknown): v is BriefCounterpoint {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.tickerId === "string" &&
    o.tickerId.trim() !== "" &&
    typeof o.stance === "string" &&
    VALID_STANCES.has(o.stance) &&
    typeof o.text === "string" &&
    o.text.trim() !== "" &&
    Array.isArray(o.basis) &&
    o.basis.length > 0 &&
    o.basis.every((b) => typeof b === "string" && b.trim() !== "")
  );
}

function isValidBrief(v: unknown): v is Brief {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.schema_version !== 1) return false;
  if (typeof o.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) return false;
  if (typeof o.generated_at !== "string") return false;
  if (o.generated_by !== "ai") return false;
  if (typeof o.model !== "string" || o.model.trim() === "") return false;
  if (typeof o.summary !== "string" || o.summary.trim() === "") return false;
  if (!Array.isArray(o.counterpoints) || !o.counterpoints.every(isValidCounterpoint)) return false;
  const health = o.health as Record<string, unknown> | undefined;
  if (typeof health !== "object" || health === null) return false;
  const sources = health.sources as Record<string, unknown> | undefined;
  if (typeof sources !== "object" || sources === null) return false;
  if (
    typeof sources.kessan !== "boolean" ||
    typeof sources.jukyu !== "boolean" ||
    typeof sources.state !== "boolean"
  ) {
    return false;
  }
  return true;
}

/** 1日分のブリーフをGitHub Contents API経由で取得する。404・ネットワークエラー・検証失敗はnull。 */
async function fetchOneDay(token: string, dateStr: string): Promise<Brief | null> {
  let res: Response;
  try {
    res = await fetch(briefUrl(dateStr), { headers: githubHeaders(token), cache: "no-cache" });
  } catch {
    return null;
  }
  if (!res.ok) return null; // 404は正常系(その日はまだ生成されていない)。
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.content !== "string" || p.encoding !== "base64") return null;
  let text: string;
  try {
    text = fromBase64Utf8(p.content);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isValidBrief(parsed) ? parsed : null;
}

/**
 * 引け後ブリーフを読む。トークン未設定なら通信せず`no-token`を返す(トークンゲート)。
 * `today`から順に最大3日分(今日→前日→前々日)試行し、最初に見つかったものを返す。
 * すべて404・取得失敗なら`unavailable`(呼び出し側はカード自体を表示しない)。
 */
export async function loadBrief(today: string): Promise<BriefResult> {
  const token = getToken();
  if (!token) return { kind: "no-token" };

  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const dateStr = i === 0 ? today : subtractDays(today, i);
    const brief = await fetchOneDay(token, dateStr);
    if (brief) return { kind: "ok", brief };
  }
  return { kind: "unavailable" };
}

/** 突合キー(docs/design.md 増分10節: 同一ブリーフ日付+tickerId+stance+textの先頭32字)。 */
export function briefFeedbackTextPrefix(text: string): string {
  return text.slice(0, 32);
}
