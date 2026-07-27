import { useState } from "preact/hooks";
import { REASON_TAG_PRESETS, ReasonTag, TradeInput, TradeSide } from "../types";
import { todayStr } from "../lib/date";

interface Props {
  tickerId: string;
  side: TradeSide;
  onSubmit: (input: TradeInput) => void;
  onCancel: () => void;
}

const SIDE_LABEL: Record<TradeSide, string> = { buy: "買い", sell: "売り" };

/** 取引下書きフォーム(増分3)。カルテ画面の「買いを記録」「売りを記録」から開く。 */
export function TradeForm({ tickerId, side, onSubmit, onCancel }: Props) {
  const [date, setDate] = useState(todayStr());
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [stop, setStop] = useState("");
  const [memo, setMemo] = useState("");
  const [tags, setTags] = useState<Set<ReasonTag>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggleTag(tag: ReasonTag) {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!date) {
      setError("日付を入力してください");
      return;
    }
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError("数量は正の数で入力してください");
      return;
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("単価は0以上の数で入力してください");
      return;
    }
    let stopNum: number | undefined;
    if (stop.trim() !== "") {
      stopNum = Number(stop);
      if (!Number.isFinite(stopNum) || stopNum <= 0) {
        setError("損切りラインは正の数で入力してください");
        return;
      }
    }
    setError(null);
    onSubmit({
      tickerId,
      side,
      date,
      qty: qtyNum,
      price: priceNum,
      stop: stopNum,
      reasonTags: Array.from(tags),
      memo: memo.trim() === "" ? undefined : memo.trim(),
    });
  }

  return (
    <form class="trade-form" onSubmit={handleSubmit}>
      <h3>{SIDE_LABEL[side]}を記録</h3>
      <div class="trade-form__row">
        <label>
          日付
          <input
            type="date"
            value={date}
            onInput={(e) => setDate((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          数量
          <input
            type="number"
            min="1"
            step="1"
            value={qty}
            onInput={(e) => setQty((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="trade-form__row">
        <label>
          単価
          <input
            type="number"
            min="0"
            step="any"
            value={price}
            onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          損切りライン(任意)
          <input
            type="number"
            min="0"
            step="any"
            value={stop}
            onInput={(e) => setStop((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <fieldset class="trade-form__tags">
        <legend>理由タグ</legend>
        {REASON_TAG_PRESETS.map((tag) => (
          <label class="trade-form__tag" key={tag}>
            <input type="checkbox" checked={tags.has(tag)} onChange={() => toggleTag(tag)} />
            {tag}
          </label>
        ))}
      </fieldset>
      <label class="trade-form__memo">
        メモ(任意)
        <input
          type="text"
          value={memo}
          onInput={(e) => setMemo((e.target as HTMLInputElement).value)}
        />
      </label>
      {error && <p class="trade-form__error">{error}</p>}
      <div class="trade-form__actions">
        <button type="button" class="trade-form__cancel" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit">記録する</button>
      </div>
    </form>
  );
}
