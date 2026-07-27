import { useEffect, useRef } from "preact/hooks";
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
 *
 * reviewer軽微17: フォーカストラップ・背景スクロールロックを実装する。Escは意図的に
 * 無告知クローズをしない(このダイアログは必ずどちらかを選ばせる設計で、中立な
 * キャンセルが無いため。Escでの無告知クローズは「どちらの変更が残ったか分からない」
 * 事故につながる)。
 */
export function ConflictDialog({ remoteState, onAdoptRemote, onKeepLocal }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const adoptRemoteButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    adoptRemoteButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // 中立なキャンセルが無いため、Escは無視する(上のコメント参照)。
        e.preventDefault();
        return;
      }
      if (e.key !== "Tab") return;
      const container = dialogRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>("button");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div class="conflict-dialog__backdrop" role="presentation">
      <div
        class="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        ref={dialogRef}
      >
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
          <button type="button" ref={adoptRemoteButtonRef} onClick={onAdoptRemote}>
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
