import { STATUS_LABEL_JA, Ticker, TICKER_STATUSES, TickerStatus, Trade } from "../types";
import { TickerRow } from "./TickerRow";
import { computePosition } from "../lib/position";
import { JudgmentEvent } from "../lib/events";
import { tickerHref } from "../lib/router";
import { daysBetween } from "../lib/date";

interface Props {
  tickers: Ticker[];
  trades: Trade[];
  onStatusChange: (id: string, status: TickerStatus) => void;
  /** 増分5: 今日の判断キュー(決算接近・高値接近/更新・損切り接近)。 */
  events: JudgmentEvent[];
  /** 決算ナビのデータ日付(YYYY-MM-DD)。取得中・取得失敗ならnull。 */
  kessanAsOf: string | null;
  /** 需給ナビのデータ日付(YYYY-MM-DD)。取得中・取得失敗ならnull。 */
  jukyuAsOf: string | null;
  kessanError: boolean;
  jukyuError: boolean;
  /** 起動直後、pipelineの初回fetchがまだ終わっていない間はtrue。 */
  pipelineLoading: boolean;
  today: string;
  /** 増分7: 判断キューの各カードから見送りワンタップの理由タグ選択ダイアログを開く。 */
  onOpenPass: (tickerId: string) => void;
}

const STALE_THRESHOLD_DAYS = 7;

/** 出典欄1件分の表示文字列(取得中/取得不可/日付+古いデータ警告)。 */
function sourceLabel(asOf: string | null, error: boolean, loading: boolean, today: string): string {
  if (loading) return "取得中…";
  if (error || asOf === null) return "取得不可(ローカル機能は正常)";
  const stale = daysBetween(asOf, today) > STALE_THRESHOLD_DAYS;
  return stale ? `${asOf}(古いデータ)` : asOf;
}

/** 今日の判断キュー(増分5): 決算接近・高値接近/更新・損切り接近を今日画面の先頭に表示する。 */
function JudgmentQueue({
  events,
  kessanAsOf,
  jukyuAsOf,
  kessanError,
  jukyuError,
  pipelineLoading,
  today,
  onOpenPass,
}: Props) {
  return (
    <section class="judgment-queue">
      <h2>今日の判断キュー</h2>
      {events.length === 0 ? (
        <p class="empty-state empty-state--small">今日judgmentが必要な変化はありません</p>
      ) : (
        <ul class="judgment-queue__list">
          {events.map((e) => (
            <li class="judgment-queue__item" key={e.id}>
              <a class="judgment-queue__link" href={tickerHref(e.tickerId)}>
                <span class={`judgment-queue__badge judgment-queue__badge--${e.kind}`}>{e.label}</span>
                <span class="judgment-queue__name">{e.tickerName}</span>
              </a>
              <p class="judgment-queue__detail">{e.detail}</p>
              <p class="judgment-queue__date">データ日付: {e.dataDate}</p>
              <button type="button" class="judgment-queue__pass-btn" onClick={() => onOpenPass(e.tickerId)}>
                見送る
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="judgment-queue__sources">
        出典: 決算ナビ({sourceLabel(kessanAsOf, kessanError, pipelineLoading, today)}) / 需給ナビ(
        {sourceLabel(jukyuAsOf, jukyuError, pipelineLoading, today)})
      </p>
    </section>
  );
}

/**
 * 「今日」画面: 先頭に判断キュー(増分5)、続けて銘柄を状態別にグループ表示する。
 * 増分3: 保有(holding)グループの各行に、建玉があるものだけ保有数量・平均単価を1行サブ表示する。
 */
export function TodayQueue(props: Props) {
  const { tickers, trades, onStatusChange } = props;

  if (tickers.length === 0) {
    return (
      <section class="today-queue">
        <JudgmentQueue {...props} />
        <p class="empty-state">
          登録された銘柄がありません。下のフォームから候補銘柄を追加してください。
        </p>
      </section>
    );
  }

  return (
    <section class="today-queue">
      <JudgmentQueue {...props} />
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
