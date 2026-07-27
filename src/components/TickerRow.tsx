import { Ticker, TickerStatus, TICKER_STATUSES, STATUS_LABEL_JA } from "../types";

interface Props {
  ticker: Ticker;
  onStatusChange: (id: string, status: TickerStatus) => void;
}

/** 銘柄1件のカード表示。状態変更セレクトを持つ。 */
export function TickerRow({ ticker, onStatusChange }: Props) {
  return (
    <li class="ticker-row">
      <div class="ticker-row__main">
        <span class="ticker-row__id">{ticker.id}</span>
        <span class="ticker-row__name">{ticker.name}</span>
        <span class="ticker-row__currency">{ticker.currency}</span>
      </div>
      <div class="ticker-row__meta">
        <span class="ticker-row__date">更新: {ticker.updatedAt}</span>
        <label class="ticker-row__status">
          状態
          <select
            value={ticker.status}
            onChange={(e) =>
              onStatusChange(ticker.id, (e.target as HTMLSelectElement).value as TickerStatus)
            }
          >
            {TICKER_STATUSES.map((s) => (
              <option value={s}>{STATUS_LABEL_JA[s]}</option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}
