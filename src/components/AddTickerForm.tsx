import { useState } from "preact/hooks";
import { CURRENCY_BY_MARKET, Market, TickerStatus, STATUS_LABEL_JA, TICKER_STATUSES } from "../types";

interface Props {
  onAdd: (input: { market: Market; code: string; name: string; status: TickerStatus }) => string | null;
}

/** 銘柄の手動追加フォーム。市場(JP/US)・コード・名称・初期状態を入力する。 */
export function AddTickerForm({ onAdd }: Props) {
  const [market, setMarket] = useState<Market>("JP");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<TickerStatus>("candidate");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      setError("コードを入力してください");
      return;
    }
    if (!trimmedName) {
      setError("名称を入力してください");
      return;
    }
    const err = onAdd({ market, code: trimmedCode, name: trimmedName, status });
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setCode("");
    setName("");
  }

  return (
    <form class="add-form" onSubmit={handleSubmit}>
      <h2>銘柄を追加</h2>
      <div class="add-form__row">
        <label>
          市場
          <select
            value={market}
            onChange={(e) => setMarket((e.target as HTMLSelectElement).value as Market)}
          >
            <option value="JP">JP(日本円)</option>
            <option value="US">US(米ドル)</option>
          </select>
        </label>
        <label>
          コード
          <input
            type="text"
            placeholder={market === "JP" ? "7203" : "NVDA"}
            value={code}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <label class="add-form__name">
        名称
        <input
          type="text"
          placeholder="銘柄名"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="add-form__status">
        初期状態
        <select
          value={status}
          onChange={(e) => setStatus((e.target as HTMLSelectElement).value as TickerStatus)}
        >
          {TICKER_STATUSES.map((s) => (
            <option value={s}>{STATUS_LABEL_JA[s]}</option>
          ))}
        </select>
      </label>
      {error && <p class="add-form__error">{error}</p>}
      <p class="add-form__hint">
        通貨は市場から自動決定されます({CURRENCY_BY_MARKET[market]})
      </p>
      <button type="submit">追加</button>
    </form>
  );
}
