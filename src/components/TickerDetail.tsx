import { useEffect, useState } from "preact/hooks";
import { AppSettings, Market, STATUS_LABEL_JA, Ticker, TICKER_STATUSES, TickerStatus, Trade, TradeInput, TradeSide } from "../types";
import { kessanNaviUrl, jukyuNaviUrl } from "../lib/external";
import { computePosition } from "../lib/position";
import { formatMoney } from "../lib/format";
import { PriceSeries } from "../lib/pipeline";
import { latestClose, weeklyHigh } from "../lib/events";
import { loadSupplyDemandData, SupplyDemandResult } from "../lib/supplyDemand";
import { TradeForm } from "./TradeForm";
import { SupplyDemandDonut } from "./SupplyDemandDonut";

interface Props {
  ticker: Ticker | undefined;
  trades: Trade[];
  onStatusChange: (id: string, status: TickerStatus) => void;
  onAddTrade: (input: TradeInput) => void;
  onDeleteTrade: (tradeId: string) => void;
  /** 増分5: 需給ナビの株価シリーズ(銘柄コード-> シリーズ)。JP銘柄のみ対象。 */
  prices: Map<string, PriceSeries>;
  /** 増分7: ポジションサイズ計算機の既定許容損失額(通貨別)。 */
  settings: AppSettings | undefined;
  /** 増分7: 見送りワンタップの理由タグ選択ダイアログを開く(`src/app.tsx` `handleOpenPass`)。 */
  onOpenPass: (tickerId: string) => void;
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
export function TickerDetail({
  ticker,
  trades,
  onStatusChange,
  onAddTrade,
  onDeleteTrade,
  prices,
  settings,
  onOpenPass,
}: Props) {
  const [draftSide, setDraftSide] = useState<TradeSide | null>(null);
  // 増分8: 需給ドーナツ。カルテを開くたびに対象コードだけをfetchする(全銘柄一括先読みはしない)。
  // フックはRules of Hooksにより早期returnより前で無条件に呼ぶ必要があるため、
  // market/codeの算出も(ticker未確定時のフォールバック込みで)ここへ引き上げる。
  const [market, code] = ticker ? splitId(ticker.id) : ["", ""];
  const [supplyDemand, setSupplyDemand] = useState<SupplyDemandResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSupplyDemand(null);
    if (market === "JP" && code !== "") {
      loadSupplyDemandData(code).then((data) => {
        if (!cancelled) setSupplyDemand(data);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [market, code]);

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

  const tickerTrades = trades.filter((t) => t.tickerId === ticker.id);
  const position = computePosition(tickerTrades, ticker.id);
  const history = sortHistoryDesc(tickerTrades);
  // ポジションサイズ計算機(増分7)の既定許容損失額。銘柄の通貨に応じてsettingsの対応フィールドを選ぶ。
  const defaultRiskAmount = ticker.currency === "JPY" ? settings?.defaultRiskJPY : settings?.defaultRiskUSD;
  const passedEventsDesc = ticker.passedEvents ? [...ticker.passedEvents].reverse() : [];

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
        <button type="button" class="ticker-detail__pass-btn" onClick={() => onOpenPass(ticker.id)}>
          見送る
        </button>
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
                {/* 「3年高値(週足終値)」(reviewer中9): 週足終値ベースの基準であり、日中の真の高値
                    ではないことをラベルで明示する(docs/design.md 増分5節を同時改訂)。 */}
                <dt>3年高値(週足終値)からの距離</dt>
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
      {market === "JP" && (
        <div class="ticker-detail__supply-demand">
          <h2>需給</h2>
          {supplyDemand === null ? (
            <p class="empty-state empty-state--small">取得中…</p>
          ) : (
            <SupplyDemandDonut buy={supplyDemand.buy} sell={supplyDemand.sell} errors={supplyDemand.errors} />
          )}
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
                  {/* reviewer軽微19: stopLossAmount = (avgPrice - currentStop) * qty は
                      トレーリングストップ(currentStop > avgPrice、利益確定方向)だと負値になる。
                      計算式自体はdocs/design.md 増分3節の契約どおりのため変更せず、表示側で
                      符号に応じてラベルを切り替え、値は絶対値で見せる(「損失額 ¥-50,000」という
                      矛盾表示を避ける)。 */}
                  <dt>{position.stopLossAmount >= 0 ? "損切り到達時損失額" : "損切りライン到達時利益額(トレーリングストップ)"}</dt>
                  <dd>{formatMoney(Math.abs(position.stopLossAmount), ticker.currency)}</dd>
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
            currency={ticker.currency}
            market={market as Market}
            trades={tickerTrades}
            defaultRiskAmount={defaultRiskAmount}
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
      <div class="ticker-detail__pass-history">
        <h2>見送り履歴</h2>
        {passedEventsDesc.length === 0 ? (
          <p class="empty-state empty-state--small">見送り記録はありません</p>
        ) : (
          <ul class="pass-history">
            {passedEventsDesc.map((e, i) => (
              <li class="pass-history__item" key={`${e.date}-${i}`}>
                <span class="pass-history__date">{e.date}</span>
                <span class="pass-history__tags">{e.tags.join(" / ")}</span>
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
