// 増分9: 週次レビュー画面。契約はdocs/design.md 増分9節。state.trades / tickersからすべて
// ローカル計算する(外部fetch不要)。通貨はJPY/USD別々に集計して並記し、混ぜない。

import { Currency, Ticker, Trade } from "../types";
import { formatMoney } from "../lib/format";
import { tickerHref } from "../lib/router";
import {
  ClosedRound,
  computeClosedRounds,
  computePassedEventTagCounts,
  CurrencySummary,
  PassTagCount,
  summarizeByCurrency,
} from "../lib/review";

interface Props {
  tickers: Ticker[];
  trades: Trade[];
}

const CURRENCIES: Currency[] = ["JPY", "USD"];

function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${(ratio * 100).toFixed(1)}%`;
}

function formatR(r: number | null): string {
  if (r === null) return "—";
  return `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;
}

function CurrencySummaryCard({ summary }: { summary: CurrencySummary }) {
  const pfText = summary.allWinsNoLosses
    ? "全勝(損失なし)"
    : summary.profitFactor === null
      ? "—"
      : `${summary.profitFactor.toFixed(2)}倍`;

  return (
    <div class="review-summary-card">
      <h3>{summary.currency}</h3>
      {summary.closedRoundCount === 0 ? (
        <p class="empty-state empty-state--small">この通貨のクローズ済み取引はありません</p>
      ) : (
        <dl class="review-summary-card__stats">
          <dt>クローズ済みラウンド数</dt>
          <dd>{summary.closedRoundCount}</dd>
          <dt>勝率</dt>
          <dd>
            {formatPercent(summary.winRate)}({summary.winCount}/{summary.closedRoundCount})
          </dd>
          <dt>プロフィットファクター</dt>
          <dd>{pfText}</dd>
          <dt>平均R倍数(R期待値)</dt>
          <dd>
            {formatR(summary.avgR)}
            {summary.rExcludedCount > 0 && (
              <span class="review-summary-card__note">
                (stop未宣言等により{summary.rExcludedCount}件はR計算対象外)
              </span>
            )}
          </dd>
        </dl>
      )}
      {summary.mismatchedCount > 0 && (
        <p class="review-summary-card__note review-summary-card__note--warning">
          数量不整合(保有数量を超える売り)のラウンドが{summary.mismatchedCount}件あり、上記集計から除外しています。ラウンド一覧で確認してください。
        </p>
      )}
    </div>
  );
}

function PyramidSection({ summaries }: { summaries: CurrencySummary[] }) {
  const withData = summaries.filter((s) => s.pyramidRoundCount > 0);
  if (withData.length === 0) {
    return <p class="empty-state empty-state--small">ピラミッディング(2段以上)したラウンドはありません</p>;
  }
  return (
    <ul class="review-pyramid__list">
      {withData.map((s) => {
        const total = s.pyramidContributionTotal ?? 0;
        return (
          <li key={s.currency}>
            {s.currency}: {s.pyramidRoundCount}ラウンドで合計 {formatMoney(total, s.currency)}
            {total >= 0 ? "(買い増しが利益に寄与)" : "(買い増しが損失を拡大)"}
          </li>
        );
      })}
    </ul>
  );
}

function RoundListTable({ rounds }: { rounds: ClosedRound[] }) {
  if (rounds.length === 0) {
    return <p class="empty-state empty-state--small">クローズ済みの取引がまだありません</p>;
  }
  const sorted = [...rounds].sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0));
  return (
    <table class="review-round-table">
      <thead>
        <tr>
          <th>銘柄</th>
          <th>期間</th>
          <th>段数</th>
          <th>損益</th>
          <th>R倍数</th>
          <th>理由タグ</th>
          <th>警告</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.trades[0].id}>
            <td>
              <a href={tickerHref(r.tickerId)}>{r.tickerName}</a>
            </td>
            <td>
              {r.startDate}〜{r.endDate}
            </td>
            <td>{r.stageCount}</td>
            <td class={r.pnl >= 0 ? "review-round-table__pnl--win" : "review-round-table__pnl--loss"}>
              {formatMoney(r.pnl, r.currency)}
            </td>
            <td>{formatR(r.r)}</td>
            <td>{r.reasonTags.length > 0 ? r.reasonTags.join(" / ") : "—"}</td>
            <td>
              {r.qtyMismatched && (
                <span class="review-round-table__warning-badge" title="保有数量を超える売りがあり、上記サマリの集計から除外しています">
                  数量不整合
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PassedTagSection({ counts }: { counts: PassTagCount[] }) {
  if (counts.length === 0) {
    return <p class="empty-state empty-state--small">見送り記録はありません</p>;
  }
  return (
    <ul class="review-pass-tags">
      {counts.map((c) => (
        <li key={c.tag}>
          {c.tag}: {c.count}件
        </li>
      ))}
    </ul>
  );
}

/** 週次レビュー画面(`#/review`)。ダミー保存はしない(開くたびにtrades/tickersから再計算する)。 */
export function ReviewPage({ tickers, trades }: Props) {
  const rounds = computeClosedRounds(tickers, trades);
  const summaries = CURRENCIES.map((currency) => summarizeByCurrency(rounds, currency));
  const passTagCounts = computePassedEventTagCounts(tickers);

  return (
    <section class="review-page">
      <a class="back-link" href="#/">
        ← 今日画面へ戻る
      </a>
      <h1>週次レビュー</h1>

      <div class="review-page__summaries">
        {summaries.map((s) => (
          <CurrencySummaryCard key={s.currency} summary={s} />
        ))}
      </div>

      <section class="review-page__section">
        <h2>増し玉寄与</h2>
        <PyramidSection summaries={summaries} />
      </section>

      <section class="review-page__section">
        <h2>ラウンド一覧</h2>
        <RoundListTable rounds={rounds} />
      </section>

      <section class="review-page__section">
        <h2>見送り集計(直近20件)</h2>
        <PassedTagSection counts={passTagCounts} />
      </section>
    </section>
  );
}
