import { STATUS_LABEL_JA, Ticker, TICKER_STATUSES, TickerStatus, Trade } from "../types";
import { TickerRow } from "./TickerRow";
import { computePosition } from "../lib/position";

interface Props {
  tickers: Ticker[];
  trades: Trade[];
  onStatusChange: (id: string, status: TickerStatus) => void;
}

/**
 * 「今日」画面: 銘柄を状態別にグループ表示する。
 * 第1弾は判断キューの絞り込み(変化検知)を持たず、状態別の一覧が最小動作版となる。
 * 増分3: 保有(holding)グループの各行に、建玉があるものだけ保有数量・平均単価を1行サブ表示する。
 */
export function TodayQueue({ tickers, trades, onStatusChange }: Props) {
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
                  <TickerRow
                    ticker={t}
                    position={status === "holding" ? computePosition(trades, t.id) : undefined}
                    onStatusChange={onStatusChange}
                    key={t.id}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
