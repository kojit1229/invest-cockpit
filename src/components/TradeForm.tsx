import { useMemo, useState } from "preact/hooks";
import { Currency, Market, REASON_TAG_PRESETS, ReasonTag, Trade, TradeInput, TradeSide } from "../types";
import { todayStr } from "../lib/date";
import { currencySymbol, formatMoney } from "../lib/format";
import { computePosition } from "../lib/position";
import { recommendPositionSize } from "../lib/positionSize";

interface Props {
  tickerId: string;
  side: TradeSide;
  currency: Currency;
  market: Market;
  /** この銘柄の既存取引(増分7: ポジションサイズ計算機の「合計損失」計算に`computePosition`を再利用するため)。 */
  trades: Trade[];
  /** 設定画面(#/settings)の既定許容損失額(通貨別、`ticker.currency`に応じた値)。未設定なら空欄から始める。 */
  defaultRiskAmount?: number;
  onSubmit: (input: TradeInput) => void;
  onCancel: () => void;
}

const SIDE_LABEL: Record<TradeSide, string> = { buy: "買い", sell: "売り" };

/** 取引下書きフォーム(増分3)。カルテ画面の「買いを記録」「売りを記録」から開く。 */
export function TradeForm({ tickerId, side, currency, market, trades, defaultRiskAmount, onSubmit, onCancel }: Props) {
  const [date, setDate] = useState(todayStr());
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [stop, setStop] = useState("");
  const [riskAmount, setRiskAmount] = useState(
    defaultRiskAmount !== undefined ? String(defaultRiskAmount) : "",
  );
  const [memo, setMemo] = useState("");
  const [tags, setTags] = useState<Set<ReasonTag>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // ポジションサイズ計算機(増分7、買い側のみ)。docs/design.md 増分7節の契約:
  // 推奨株数 = floor(許容損失額 ÷ (エントリー価格 − stop))。エントリー<=stopはエラー表示。
  // handleSubmit側のバリデーション用ローカル変数(priceNum/stopNum)と名前が競合しないよう
  // calc接頭辞を付ける。
  const calcPriceNum = Number(price);
  const calcStopNum = Number(stop);
  const calcRiskNum = Number(riskAmount);
  const priceEntered = price.trim() !== "" && Number.isFinite(calcPriceNum) && calcPriceNum >= 0;
  const stopEntered = stop.trim() !== "" && Number.isFinite(calcStopNum) && calcStopNum > 0;
  const riskEntered = riskAmount.trim() !== "" && Number.isFinite(calcRiskNum) && calcRiskNum > 0;
  const entryNotAboveStop = priceEntered && stopEntered && !(calcPriceNum > calcStopNum);
  const sizeResult = useMemo(() => {
    if (side !== "buy" || !priceEntered || !stopEntered || !riskEntered || entryNotAboveStop) return null;
    return recommendPositionSize({ entryPrice: calcPriceNum, stop: calcStopNum, riskAmount: calcRiskNum, market });
  }, [side, priceEntered, stopEntered, riskEntered, entryNotAboveStop, calcPriceNum, calcStopNum, calcRiskNum, market]);

  // 買い増し時(既存建玉あり)の「現在の建玉全体でstopに到達した場合の合計損失」(docs/design.md
  // 増分7節)。qty=0・price=0の建玉外stop宣言だけを持つ仮想tradeをcomputePositionへ流し込むことで、
  // 既存の建玉(数量・平均取得単価)はそのままに、現在フォームに入力中のstopだけを反映させる
  // (この取引で追加する数量は含めない="現在の建玉全体"の文言どおり)。
  // date/createdAtは"9999-…"にして`computePosition`のsortTrades(日付→createdAt→idの安定ソート)で
  // 必ず最後に処理させる(空文字だと既存tradeより先頭にソートされ、後続の実tradeのstop宣言に
  // 上書きされてしまうため、この仮想stop宣言が最新として反映されるようにする)。
  const combinedStopLoss = useMemo(() => {
    if (side !== "buy" || !stopEntered) return null;
    const existing = computePosition(trades, tickerId);
    if (existing.qty <= 0) return null;
    const stopOnlyDraft: Trade = {
      id: "__position-size-draft__",
      tickerId,
      side: "buy",
      date: "9999-12-31",
      qty: 0,
      price: 0,
      stop: calcStopNum,
      reasonTags: [],
      createdAt: "9999-12-31T23:59:59",
    };
    const combined = computePosition([...trades, stopOnlyDraft], tickerId);
    return combined.stopLossAmount;
  }, [side, stopEntered, calcStopNum, trades, tickerId]);

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
      {side === "buy" && (
        <div class="position-size-calc">
          <label>
            許容損失額
            <div class="position-size-calc__risk-input">
              <span class="position-size-calc__currency">{currencySymbol(currency)}</span>
              <input
                type="number"
                min="0"
                step="any"
                value={riskAmount}
                onInput={(e) => setRiskAmount((e.target as HTMLInputElement).value)}
              />
            </div>
          </label>
          {entryNotAboveStop && (
            <p class="position-size-calc__error">stopはエントリーより下に</p>
          )}
          {/* reviewer軽微L5: 許容損失額 < 1単元あたり損失の場合、recommendPositionSizeは
              qty:0, maxLoss:0を返す。以前は「推奨株数: 0株」+使えない「この株数を使う」
              ボタンをそのまま出していた(design.mdにもこの空状態の規定が無かった)。
              0株のときは専用の空状態文言に切り替え、無意味なボタンは出さない。 */}
          {sizeResult && sizeResult.qty > 0 && (
            <p class="position-size-calc__result">
              推奨株数: {sizeResult.qty.toLocaleString()}株(この取引の最大損失{" "}
              {formatMoney(sizeResult.maxLoss, currency)})
              <button type="button" onClick={() => setQty(String(sizeResult.qty))}>
                この株数を使う
              </button>
            </p>
          )}
          {sizeResult && sizeResult.qty === 0 && (
            <p class="position-size-calc__result position-size-calc__result--zero">
              この許容損失額では{market === "JP" ? "1単元(100株)" : "1株"}も買えません
            </p>
          )}
          {combinedStopLoss !== null && (
            <p class="position-size-calc__combined">
              {/* reviewer中2: combinedStopLossはTickerDetail.tsxのstopLossAmountと同じ計算式
                  ((avgPrice - currentStop) * qty)のため、トレーリングストップ(stopを平均取得
                  単価より上へ引き上げた場合)で負値になる。以前はここで常に「合計損失」と
                  表記したままMath.absで符号を潰しており、利益が出る位置にstopを置いた
                  ケースで「合計損失: ¥120,000」という嘘の表示になっていた。TickerDetail.tsxと
                  同じく符号に応じてラベルを切り替える(値は絶対値のまま表示)。 */}
              現在の建玉全体でstopに到達した場合の
              {combinedStopLoss >= 0 ? "合計損失" : "到達時利益額(トレーリングストップ)"}:{" "}
              {formatMoney(Math.abs(combinedStopLoss), currency)}
            </p>
          )}
        </div>
      )}
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
