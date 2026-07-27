import { SyncPhase } from "../lib/sync";

interface Props {
  phase: SyncPhase;
  error: string | null;
}

const LABEL: Record<SyncPhase, string> = {
  unset: "未設定",
  idle: "未同期",
  syncing: "送信中",
  synced: "同期済",
  error: "エラー",
};

/**
 * ヘッダーのprivate repo同期状態インジケータ(増分4)。
 * 未設定(グレー)/同期済(緑)/送信中/エラー(赤+短文)。エラーでもアプリのローカル機能は
 * 生き続けるため、ここは表示のみで操作をブロックしない(docs/design.md 増分4節)。
 */
export function SyncIndicator({ phase, error }: Props) {
  const label = phase === "error" && error ? `エラー: ${error}` : LABEL[phase];
  return (
    <a class={`sync-indicator sync-indicator--${phase}`} href="#/settings" title={label}>
      <span class="sync-indicator__dot" />
      <span class="sync-indicator__label">{label}</span>
    </a>
  );
}
