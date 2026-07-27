import { Ticker, TickerStatus, TICKER_STATUSES, STATUS_LABEL_JA } from "../types";
import { tickerHref } from "../lib/router";
import { Position } from "../lib/position";
import { formatMoney } from "../lib/format";

interface Props {
  ticker: Ticker;
  /** 建玉(増分3)。呼び出し側が渡した場合のみ、保有ありなら1行サブ表示する。 */
  position?: Position;
  onStatusChange: (id: string, status: TickerStatus) => void;
}

/** 銘柄1件のカード表示。状態変更セレクトを持つ。IDと名称は銘柄カルテへのリンク。 */
export function TickerRow({ ticker, position, onStatusChange }: Props) {
  return (
    <li class="ticker-row">
      <div class="ticker-row__main">
        <a class="ticker-row__link" href={tickerHref(ticker.id)}>
          <span class="ticker-row__id">{ticker.id}</span>
          <span class="ticker-row__name">{ticker.name}</span>
        </a>
        <span class="ticker-row__currency">{ticker.currency}</span>
      </div>
      {position && position.qty > 0 && (
        <div class="ticker-row__position">
          保有 {position.qty.toLocaleString()} / 平均 {formatMoney(position.avgPrice ?? 0, ticker.currency)}
        </div>
      )}
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
