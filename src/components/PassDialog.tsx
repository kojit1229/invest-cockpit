import { useState } from "preact/hooks";
import { PASS_REASON_TAG_PRESETS, PassReasonTag } from "../types";

interface Props {
  tickerName: string;
  onConfirm: (tags: PassReasonTag[]) => void;
  onCancel: () => void;
}

/**
 * 見送りワンタップの理由タグ選択ダイアログ(増分7)。カルテ画面・今日の判断キューの両方から
 * 同じ導線(`src/app.tsx` `handleOpenPass`/`handleConfirmPass`)で開く。
 * 学習ループの入力データになるため、理由タグを1つ以上選択しないと確定できない。
 */
export function PassDialog({ tickerName, onConfirm, onCancel }: Props) {
  const [tags, setTags] = useState<Set<PassReasonTag>>(new Set());

  function toggleTag(tag: PassReasonTag) {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
    <div class="pass-dialog__backdrop">
      <div class="pass-dialog">
        <h2>{tickerName}を見送る</h2>
        <p class="pass-dialog__hint">理由タグを選択してください(複数選択可)。</p>
        <fieldset class="pass-dialog__tags">
          <legend>理由タグ</legend>
          {PASS_REASON_TAG_PRESETS.map((tag) => (
            <label class="pass-dialog__tag" key={tag}>
              <input type="checkbox" checked={tags.has(tag)} onChange={() => toggleTag(tag)} />
              {tag}
            </label>
          ))}
        </fieldset>
        <div class="pass-dialog__actions">
          <button type="button" disabled={tags.size === 0} onClick={() => onConfirm(Array.from(tags))}>
            見送る
          </button>
          <button type="button" class="pass-dialog__cancel" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
