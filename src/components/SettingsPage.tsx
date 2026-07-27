import { useState } from "preact/hooks";
import { clearToken, hasToken, setToken, SyncPhase } from "../lib/sync";
import { AppSettings } from "../types";
import { SyncIndicator } from "./SyncIndicator";

interface Props {
  syncPhase: SyncPhase;
  syncError: string | null;
  /** トークンの保存・削除の直後にapp.tsx側の状態(未設定/未同期)を再評価してもらうためのフック。 */
  onTokenChanged: () => void;
  onSyncNow: () => void;
  /** 増分7: ポジションサイズ計算機の既定許容損失額(通貨別)。 */
  settings: AppSettings | undefined;
  onSettingsChange: (settings: AppSettings) => void;
}

/**
 * 設定画面(`#/settings`)。private repo同期用のfine-grained PATを設定する
 * トークンゲート画面(増分4)。トークン未設定なら同期機能は全停止する
 * (docs/design.md 増分4節)。
 */
export function SettingsPage({ syncPhase, syncError, onTokenChanged, onSyncNow, settings, onSettingsChange }: Props) {
  const [tokenInput, setTokenInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [riskJPY, setRiskJPY] = useState(
    settings?.defaultRiskJPY !== undefined ? String(settings.defaultRiskJPY) : "",
  );
  const [riskUSD, setRiskUSD] = useState(
    settings?.defaultRiskUSD !== undefined ? String(settings.defaultRiskUSD) : "",
  );
  const [riskSaved, setRiskSaved] = useState(false);

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

  /** 増分7: ポジションサイズ計算機の既定許容損失額を保存する。0以下・非数は未設定(undefined)に落とす。 */
  function handleRiskSave(e: SubmitEvent) {
    e.preventDefault();
    const jpy = Number(riskJPY);
    const usd = Number(riskUSD);
    onSettingsChange({
      defaultRiskJPY: riskJPY.trim() !== "" && Number.isFinite(jpy) && jpy > 0 ? jpy : undefined,
      defaultRiskUSD: riskUSD.trim() !== "" && Number.isFinite(usd) && usd > 0 ? usd : undefined,
    });
    setRiskSaved(true);
  }

  return (
    <section class="settings-page">
      <a class="back-link" href="#/">
        ← 今日画面へ戻る
      </a>
      <h1>設定</h1>
      <div class="settings-page__risk">
        <h2>ポジションサイズ計算機の既定</h2>
        <p class="settings-page__hint">
          カルテ画面の「買いを記録」で使う許容損失額の初期値です(通貨別)。空欄のまま保存すると
          その通貨の初期値なし(都度手入力)に戻ります。
        </p>
        <form class="settings-page__form" onSubmit={handleRiskSave}>
          <label>
            既定許容損失額(JPY)
            <input
              type="number"
              min="0"
              step="any"
              value={riskJPY}
              placeholder="例: 50000"
              onInput={(e) => setRiskJPY((e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            既定許容損失額(USD)
            <input
              type="number"
              min="0"
              step="any"
              value={riskUSD}
              placeholder="例: 500"
              onInput={(e) => setRiskUSD((e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="settings-page__actions">
            <button type="submit">保存</button>
          </div>
        </form>
        {riskSaved && <p class="settings-page__saved">保存しました</p>}
      </div>
      <div class="settings-page__sync">
        <h2>private repo同期</h2>
        <p class="settings-page__hint">
          fine-grained PAT(<code>personal-data</code> リポジトリの Contents 読み書き権限のみ)が必要です。
          パスワードではなく権限を絞った専用の鍵なので、GitHub側で漏れてもその鍵だけを即座に無効化できます。
          ただし本アプリと同じ<code>kojit1229.github.io</code>上の他アプリからはこのブラウザのlocalStorageを
          共有で読めるため、トークン自体はこのブラウザ上の他のスクリプトからは読める状態にあります
          (docs/design.md (d)節)。トークンを設定するまで同期機能は動きません(ローカルの記録・機能はそのまま使えます)。
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
