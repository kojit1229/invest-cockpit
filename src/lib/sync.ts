// private repo同期(増分4)。GitHub Contents API経由でpersonal-dataリポジトリの
// invest-cockpit/state.json とAppStateV1を全量置換で同期する(フィールドマージなし)。
// 契約の正典: docs/design.md 増分4節。トークン未設定なら本モジュールの関数はすべて
// { kind: "no-token" } を返し、通信を一切行わない(トークンゲート)。
// 通信先はapi.github.comのみ。トークンはconsole・エラーメッセージ・同期先state.jsonの
// 中身に絶対に含めない。

import { AppStateV1 } from "../types";
import { parseAppState } from "./storage";
import { nowStr } from "./date";

const OWNER = "kojit1229";
const REPO = "personal-data";
const PATH = "invest-cockpit/state.json";
const BRANCH = "main";

const TOKEN_KEY = "invest_koro_token_v1";
const SYNC_META_KEY = "invest_koro_sync_v1";

// -----------------------------------------------------------------------
// トークン(localStorage、平文保存。fine-grained PATは漏れても対象repoの
// Contents権限のみのため、パスワードよりリスクを絞れる想定 — 設定画面の説明文と同旨)
// -----------------------------------------------------------------------

export function getToken(): string | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function hasToken(): boolean {
  return getToken() !== null;
}

export function setToken(token: string): void {
  try {
    const trimmed = token.trim();
    if (trimmed) window.localStorage.setItem(TOKEN_KEY, trimmed);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage不可(プライベートブラウズ等)。トークンは保存されないが例外は投げない。
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 無視: 削除できなくてもアプリは継続する。
  }
}

// -----------------------------------------------------------------------
// 同期メタ(localStorage別キー)。最後に同期が取れたリモートshaとタイムスタンプを保持する。
// -----------------------------------------------------------------------

export interface SyncMeta {
  lastSyncedSha: string | null;
  lastSyncedAt: string | null;
  lastSyncedModified: string | null;
}

function emptySyncMeta(): SyncMeta {
  return { lastSyncedSha: null, lastSyncedAt: null, lastSyncedModified: null };
}

export function getSyncMeta(): SyncMeta {
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY);
    if (!raw) return emptySyncMeta();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return emptySyncMeta();
    const obj = parsed as Record<string, unknown>;
    return {
      lastSyncedSha: typeof obj.lastSyncedSha === "string" ? obj.lastSyncedSha : null,
      lastSyncedAt: typeof obj.lastSyncedAt === "string" ? obj.lastSyncedAt : null,
      lastSyncedModified: typeof obj.lastSyncedModified === "string" ? obj.lastSyncedModified : null,
    };
  } catch {
    return emptySyncMeta();
  }
}

function setSyncMeta(meta: SyncMeta): void {
  try {
    window.localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // 無視: メタが保存できなくても次回同期時にGETから再判定できる。
  }
}

// -----------------------------------------------------------------------
// UTF-8 base64(純関数)。btoa/atobの素の呼び出しはマルチバイト文字を壊すため
// TextEncoder/TextDecoder経由にする(taskchute-ipadの既存パターンを踏襲)。
// -----------------------------------------------------------------------

export function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// -----------------------------------------------------------------------
// 同期方針の判定(純関数)。GET結果とローカルstate.lastModifiedとsyncMetaだけから
// 「何もしない/pushする/remoteを採用する/競合ダイアログを出す」を決める。
// docs/design.md 増分4節の決定表そのもの。
// -----------------------------------------------------------------------

export type SyncDecision =
  | { kind: "in-sync" }
  | { kind: "push-local" }
  | { kind: "adopt-remote" }
  | { kind: "conflict" };

export function decideSyncAction(params: {
  remoteSha: string;
  localModified: string;
  meta: SyncMeta;
}): SyncDecision {
  const { remoteSha, localModified, meta } = params;
  // lastSyncedShaが無い(一度も同期していない)場合、リモートは常に「未知の変更」として扱う。
  const remoteChanged = meta.lastSyncedSha === null || remoteSha !== meta.lastSyncedSha;
  // lastSyncedModifiedが無い場合、ローカルは常に「同期基準点より新しい」として扱う
  // (安全側: 初回同期でリモートに既存データがあれば無条件採用ではなく競合ダイアログに倒す)。
  const localChanged = meta.lastSyncedModified === null || localModified > meta.lastSyncedModified;

  if (!remoteChanged && !localChanged) return { kind: "in-sync" };
  if (!remoteChanged && localChanged) return { kind: "push-local" };
  if (remoteChanged && !localChanged) return { kind: "adopt-remote" };
  return { kind: "conflict" };
}

// -----------------------------------------------------------------------
// GitHub Contents API 低レベル呼び出し
// -----------------------------------------------------------------------

function contentsUrl(): string {
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** ステータスコードから日本語の短い説明を作る(トークンの値は含めない)。 */
function friendlyError(status: number): string {
  switch (status) {
    case 401:
      return "トークンが無効です(設定画面で貼り直してください)";
    case 403:
      return "トークンにこのリポジトリへの権限がありません(Contents読み書き権限を確認してください)";
    case 404:
      return "リポジトリまたはファイルが見つかりません";
    default:
      return `同期エラー(HTTP ${status})`;
  }
}

type GetOutcome =
  | { status: "ok"; sha: string; state: AppStateV1 }
  | { status: "not-found" }
  | { status: "error"; message: string };

async function rawGet(token: string): Promise<GetOutcome> {
  let res: Response;
  try {
    res = await fetch(`${contentsUrl()}?ref=${encodeURIComponent(BRANCH)}`, {
      headers: githubHeaders(token),
    });
  } catch {
    return { status: "error", message: "ネットワークエラー(通信できませんでした)" };
  }
  if (res.status === 404) return { status: "not-found" };
  if (!res.ok) return { status: "error", message: friendlyError(res.status) };
  let payload: unknown;
