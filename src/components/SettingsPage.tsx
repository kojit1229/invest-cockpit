import { useState } from "preact/hooks";
import { clearToken, hasToken, setToken, SyncPhase } from "../lib/sync";
import { SyncIndicator } from "./SyncIndicator";

interface Props {
  syncPhase: SyncPhase;
  syncError: string | null;
  /** トークンの保存・削除の直後にapp.tsx側の状態(未設定/未同期)を再評価してもらうためのフック。 */
  onTokenChanged: () => void;
  onSyncNow: () => void;
}

/**
 * 設定画面(`#/settings`)。private repo同期用のfine-grained PATを設定する
 * トークンゲート画面(増分4)。トークン未設定なら同期機能は全停止する
 * (docs/design.md 増分4節)。
 */
export function SettingsPage({ syncPhase, syncError, onTokenChanged, onSyncNow }: Props) {
  const [tokenInput, setTokenInput] = useState("");
  const [saved, setSaved] = useState(false);

  function handleSave(e: SubmitEvent) {
    e.preventDefault();
    if (tokenInput.trim() === "") return;
    setToken(tokenInput);
    setTokenInput("");
    setSaved(true);
    onTokenChanged();
  }

  function handleClear() {
    if (!window.confirm("トークンを削除しますか?private repo同期が停止します(ローカルの記録はそのまま残ります)。")) {
      return;
    }
    clearToken();
    setSaved(false);
    onTokenChanged();
  }

  return (
    <section class="settings-page">
      <a class="back-link" href="#/">
        ← 今日画面へ戻る
      </a>
      <h1>設定</h1>
      <div class="settings-page__sync">
        <h2>private repo同期</h2>
        <p class="settings-page__hint">
          fine-grained PAT(<code>personal-data</code> リポジトリの Contents 読み書き権限のみ)が必要です。
          パスワードではなく権限を絞った専用の鍵なので、漏れてもその鍵だけを即座に無効化できます。
          トークンを設定するまで同期機能は動きません(ローカルの記録・機能はそのまま使えます)。
        </p>
        <p class="settings-page__status">
          現在の状態: <SyncIndicator phase={syncPhase} error={syncError} />
        </p>
        <form class="settings-page__form" onSubmit={handleSave}>
          <label>
            fine-grained PAT
            <input
              type="password"
              autocomplete="off"
              value={tokenInput}
              placeholder={hasToken() ? "設定済み(変更する場合は貼り直してください)" : "github_pat_..."}
              onInput={(e) => setTokenInput((e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="settings-page__actions">
            <button type="submit">保存</button>
            {hasToken() && (
              <button type="button" class="settings-page__clear" onClick={handleClear}>
                削除
              </button>
            )}
          </div>
        </form>
        {saved && <p class="settings-page__saved">保存しました</p>}
        {hasToken() && (
          <button type="button" class="settings-page__sync-now" onClick={onSyncNow}>
            今すぐ同期
          </button>
        )}
      </div>
    </section>
  );
}
