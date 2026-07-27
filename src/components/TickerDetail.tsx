import { useState } from "preact/hooks";
import { STATUS_LABEL_JA, Ticker, TICKER_STATUSES, TickerStatus, Trade, TradeInput, TradeSide } from "../types";
import { kessanNaviUrl, jukyuNaviUrl } from "../lib/external";
import { computePosition } from "../lib/position";
import { formatMoney } from "../lib/format";
import { PriceSeries } from "../lib/pipeline";
import { latestClose, weeklyHigh } from "../lib/events";
import { TradeForm } from "./TradeForm";

interface Props {
  ticker: Ticker | undefined;
  trades: Trade[];
  onStatusChange: (id: string, status: TickerStatus) => void;
  onAddTrade: (input: TradeInput) => void;
  onDeleteTrade: (tradeId: string) => void;
  /** 増分5: 需給ナビの株価シリーズ(銘柄コード-> シリーズ)。JP銘柄のみ対象。 */
  prices: Map<string, PriceSeries>;
}

/** 銘柄IDを市場プレフィックスとコードに分ける。"JP:7203" -> ["JP", "7203"] */
function splitId(id: string): [string, string] {
  const idx = id.indexOf(":");
  if (idx === -1) return ["", id];
  return [id.slice(0, idx), id.slice(idx + 1)];
}

/** 取引履歴を新しい順(日付desc、同日はcreatedAt desc)に並べる。 */
function sortHistoryDesc(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

/** 銘柄カルテ画面(`#/ticker/<id>`)。銘柄の詳細、建玉、取引記録・履歴、旧アプリへの深掘りリンクを表示する。 */
export function TickerDetail({ ticker, trades, onStatusChange, onAddTrade, onDeleteTrade, prices }: Props) {
  const [draftSide, setDraftSide] = useState<TradeSide | null>(null);

  if (!ticker) {
    return (
      <section class="ticker-detail">
        <a class="back-link" href="#/">
          ← 今日画面へ戻る
        </a>
        <p class="empty-state">この銘柄は見つかりません(削除された可能性があります)</p>
      </section>
    );
  }

  const [market, code] = splitId(ticker.id);
  const tickerTrades = trades.filter((t) => t.tickerId === ticker.id);
  const position = computePosition(tickerTrades, ticker.id);
  const history = sortHistoryDesc(tickerTrades);

  return (
    <section class="ticker-detail">
      <a class="back-link" href="#/">
        ← 今日画面へ戻る
      </a>
      <h1>{ticker.name}</h1>
      <dl class="ticker-detail__meta">
        <dt>ID</dt>
        <dd>{ticker.id}</dd>
        <dt>通貨</dt>
        <dd>{ticker.currency}</dd>
        <dt>登録日</dt>
        <dd>{ticker.createdAt}</dd>
        <dt>更新日</dt>
        <dd>{ticker.updatedAt}</dd>
        {ticker.importedFrom && (
          <>
            <dt>インポート元</dt>
            <dd>{ticker.importedFrom}</dd>
          </>
        )}
      </dl>
      <label class="ticker-detail__status">
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
      {market === "JP" && (
        <div class="ticker-detail__price">
          <h2>株価</h2>
          {(() => {
            const series = prices.get(code);
            const latest = series ? latestClose(series) : null;
            const high = series ? weeklyHigh(series) : null;
            if (!series || !latest || high === null || high <= 0) {
              return <p class="empty-state empty-state--small">価格データなし(対象226銘柄外)</p>;
            }
            const ratio = latest.value / high;
            return (
              <dl class="price-info">
                <dt>最新株価</dt>
                <dd>
                  {formatMoney(latest.value, ticker.currency)}({latest.date})
                </dd>
                <dt>3年高値からの距離</dt>
                <dd>
                  {ratio > 1
                    ? `高値更新中(3年高値 ${formatMoney(high, ticker.currency)})`
                    : `残り${((1 - ratio) * 100).toFixed(1)}%(3年高値 ${formatMoney(high, ticker.currency)})`}
                </dd>
                {position.qty > 0 && position.currentStop !== null && (
                  <>
                    <dt>損切りラインまでの距離</dt>
                    <dd>
                      {position.currentStop > 0
                        ? `${(((latest.value - position.currentStop) / position.currentStop) * 100).toFixed(1)}%`
                        : "—"}
                    </dd>
                  </>
                )}
              </dl>
            );
          })()}
        </div>
      )}
      <div class="ticker-detail__position">
        <h2>建玉</h2>
        {position.qty === 0 ? (
          <p class="empty-state empty-state--small">建玉なし</p>
        ) : (
          <>
            <dl class="position-summary">
              <dt>保有数量</dt>
              <dd>{position.qty.toLocaleString()}</dd>
              <dt>平均取得単価</dt>
              <dd>{formatMoney(position.avgPrice ?? 0, ticker.currency)}</dd>
              <dt>損切りライン</dt>
              <dd>
                {position.currentStop !== null
                  ? formatMoney(position.currentStop, ticker.currency)
                  : "未宣言"}
              </dd>
              {position.stopLossAmount !== null && (
                <>
                  <dt>損切り到達時損失額</dt>
                  <dd>{formatMoney(position.stopLossAmount, ticker.currency)}</dd>
                </>
              )}
            </dl>
            <table class="position-stages">
              <thead>
                <tr>
                  <th>段</th>
                  <th>日付</th>
                  <th>数量</th>
                  <th>単価</th>
                </tr>
              </thead>
              <tbody>
                {position.stages.map((s) => (
                  <tr key={s.trade.id}>
                    <td>{s.stage}</td>
                    <td>{s.trade.date}</td>
                    <td>{s.trade.qty.toLocaleString()}</td>
                    <td>{formatMoney(s.trade.price, ticker.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div class="ticker-detail__trade-buttons">
          <button type="button" onClick={() => setDraftSide("buy")}>
            買いを記録
          </button>
          <button type="button" onClick={() => setDraftSide("sell")}>
            売りを記録
          </button>
        </div>
        {draftSide && (
          <TradeForm
            tickerId={ticker.id}
            side={draftSide}
            onSubmit={(input) => {
              onAddTrade(input);
              setDraftSide(null);
            }}
            onCancel={() => setDraftSide(null)}
          />
        )}
      </div>
      <div class="ticker-detail__history">
        <h2>取引履歴</h2>
        {history.length === 0 ? (
          <p class="empty-state empty-state--small">取引記録はありません</p>
        ) : (
          <ul class="trade-history">
            {history.map((t) => (
              <li class="trade-history__item" key={t.id}>
                <div class="trade-history__main">
                  <span class={`trade-history__side trade-history__side--${t.side}`}>
                    {t.side === "buy" ? "買い" : "売り"}
                  </span>
                  <span class="trade-history__date">{t.date}</span>
                  <span class="trade-history__qty">{t.qty.toLocaleString()}</span>
                  <span class="trade-history__price">{formatMoney(t.price, ticker.currency)}</span>
                </div>
                {t.stop !== undefined && (
                  <div class="trade-history__stop">
                    損切り宣言: {formatMoney(t.stop, ticker.currency)}
                  </div>
                )}
                {t.reasonTags.length > 0 && (
                  <div class="trade-history__tags">{t.reasonTags.join(" / ")}</div>
                )}
                {t.memo && <div class="trade-history__memo">{t.memo}</div>}
                <button
                  type="button"
                  class="trade-history__delete"
                  onClick={() => {
                    if (window.confirm("この取引記録を削除しますか?")) onDeleteTrade(t.id);
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div class="ticker-detail__links">
        <h2>深掘りリンク</h2>
        {market === "JP" ? (
          <ul>
            <li>
              <a href={kessanNaviUrl(code)} target="_blank" rel="noopener noreferrer">
                決算ナビで見る
              </a>
            </li>
            <li>
              <a href={jukyuNaviUrl(code)} target="_blank" rel="noopener noreferrer">
                需給ナビで見る
              </a>
            </li>
          </ul>
        ) : (
          <p class="empty-state empty-state--small">US銘柄は深掘りリンクの対象外です</p>
        )}
      </div>
    </section>
  );
}
