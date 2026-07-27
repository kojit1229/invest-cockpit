import { STATUS_LABEL_JA, Ticker, TICKER_STATUSES, TickerStatus } from "../types";
import { TickerRow } from "./TickerRow";

interface Props {
  tickers: Ticker[];
  onStatusChange: (id: string, status: TickerStatus) => void;
}

/**
 * 「今日」画面: 銘柄を状態別にグループ表示する。
 * 第1弾は判断キューの絞り込み(変化検知)を持たず、状態別の一覧が最小動作版となる。
 */
export function TodayQueue({ tickers, onStatusChange }: Props) {
  if (tickers.length === 0) {
    return (
      <section class="today-queue">
        <p class="empty-state">
          登録された銘柄がありません。下のフォームから候補銘柄を追加してください。
        </p>
      </section>
    );
  }

  return (
    <section class="today-queue">
      {TICKER_STATUSES.map((status) => {
        const group = tickers.filter((t) => t.status === status);
        return (
          <div class="today-queue__group" key={status}>
            <h2>
              {STATUS_LABEL_JA[status]}
              <span class="today-queue__count">{group.length}</span>
            </h2>
            {group.length === 0 ? (
              <p class="empty-state empty-state--small">該当する銘柄はありません</p>
            ) : (
              <ul class="ticker-list">
                {group.map((t) => (
                  <TickerRow ticker={t} onStatusChange={onStatusChange} key={t.id} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
