import { AppStateV1 } from "../types";

interface Props {
  remoteState: AppStateV1;
  onAdoptRemote: () => void;
  onKeepLocal: () => void;
}

/**
 * 同期競合ダイアログ(増分4)。この端末とリモート(personal-data)の両方が
 * 前回同期時点から変更されている場合だけ表示する(docs/design.md 増分4節の決定表)。
 * 選ばなかった側の変更は失われる旨を明示する。
 */
export function ConflictDialog({ remoteState, onAdoptRemote, onKeepLocal }: Props) {
  return (
    <div class="conflict-dialog__backdrop" role="presentation">
      <div class="conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-dialog-title">
        <h2 id="conflict-dialog-title">同期の競合</h2>
        <p>
          この端末とリモート(personal-data)の両方でデータが変更されています。
          どちらを採用するか選んでください。採用しなかった側の変更は失われます。
        </p>
        <dl class="conflict-dialog__meta">
          <dt>リモート側の銘柄数</dt>
          <dd>{remoteState.tickers.length}件</dd>
          <dt>リモート側の最終更新</dt>
          <dd>{remoteState.lastModified || "不明"}</dd>
        </dl>
        <div class="conflict-dialog__actions">
          <button type="button" onClick={onAdoptRemote}>
            リモートを採用
          </button>
          <button type="button" onClick={onKeepLocal}>
            この端末を採用
          </button>
        </div>
      </div>
    </div>
  );
}
