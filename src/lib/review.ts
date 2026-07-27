// 増分9: 週次レビュー画面のドメインロジック(ラウンド集計・R倍数・プロフィットファクター・増し玉寄与)。
// 契約はdocs/design.md 増分9節。UIから独立した純関数のみを置く(src/components/ReviewPage.tsxが呼ぶ)。
// state.trades / tickersからすべてローカル計算する(外部fetch不要)。

import { Currency, PassReasonTag, PASS_REASON_TAG_PRESETS, Ticker, Trade } from "../types";
import { splitRounds } from "./position";

/** クローズ済みラウンド1件分(建玉が0になった一連の取引のまとまり。position.ts splitRoundsと同じ境界)。 */
export interface ClosedRound {
  tickerId: string;
  tickerName: string;
  currency: Currency;
  trades: Trade[];
  /** YYYY-MM-DD(ラウンド最初のtradeのdate)。 */
  startDate: string;
  /** YYYY-MM-DD(ラウンド最後のtradeのdate)。 */
  endDate: string;
  /** 買いtrade件数(ピラミッディング段数)。 */
  stageCount: number;
  /** ラウンド損益 = 売り合計金額 - 買い合計金額。 */
  pnl: number;
  /** 初期リスク = ラウンド最初の買いの(entry-stop)*qty。stop未宣言または entry<=stop はnull。 */
  initialRisk: number | null;
  /** R倍数 = pnl / initialRisk。initialRiskがnullまたは0以下ならnull(R計算対象外)。 */
  r: number | null;
  /** ラウンド内の全tradeのreasonTagsを重複排除して出現順に並べたもの。 */
  reasonTags: string[];
  /**
   * 増し玉寄与(買い増しが足した/削った金額) = 実際のP&L - 仮想P&L(初期玉のみ)。
   * 買いtradeが2件以上(ピラミッディングした)ラウンドのみ算出。それ以外はnull。
   */
  pyramidContribution: number | null;
  /**
   * 保有数量を超える売り(フラット時の単独売り含む)があったラウンドか(Codex P2 + reviewer中3。
   * `position.ts` `splitRounds`が導出)。trueの場合、このラウンドの`pnl`・`r`・`pyramidContribution`は
   * `summarizeByCurrency`のPF・勝率・R・増し玉寄与の集計から除外される。ラウンド一覧表には
   * 残し、警告タグを表示する(黙って架空の損益を計上しない)。
   */
  qtyMismatched: boolean;
}

function uniqueReasonTags(trades: Trade[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of trades) {
    for (const tag of t.reasonTags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
  }
  return tags;
}

/**
 * 1銘柄分のクローズ済みラウンドを計算する。
 *
 * 増し玉寄与の定義(docs/design.md 増分9節): 初期玉(ラウンド最初の買いのqty)だけを買い、
 * ラウンドの平均売却単価(売り合計金額÷売り合計数量)で売り切ったと仮定した「仮想P&L」を
 * `qty0 * (avgExitPrice - entryPrice0)`で計算し、実際のP&Lとの差分を増し玉の寄与とする。
 * ラウンドは開始・終了とも建玉0のため、実際のP&Lは売り合計金額-買い合計金額の単純差分で
 * 正しい実現損益になる(平均単価法を経由する必要がない)。
 */
function buildClosedRoundsForTicker(ticker: Ticker, allTrades: Trade[]): ClosedRound[] {
  const rounds = splitRounds(allTrades, ticker.id).filter((round) => round.closed);

  return rounds.map((round) => {
    const trades = round.trades;
    const buys = trades.filter((t) => t.side === "buy");
    const sells = trades.filter((t) => t.side === "sell");
    const buyCost = buys.reduce((acc, t) => acc + t.qty * t.price, 0);
    const sellProceeds = sells.reduce((acc, t) => acc + t.qty * t.price, 0);
    const pnl = sellProceeds - buyCost;

    // ラウンドは必ずqty>0にする買い(=このラウンドの最初のtrade)から始まる。ただし不整合データ
    // (建玉が無い状態での売り)がラウンドの唯一のtradeになる退化ケースではbuysが空になりうる。
    const firstBuy = buys[0];
    const initialRisk =
      firstBuy !== undefined && firstBuy.stop !== undefined && firstBuy.stop < firstBuy.price
        ? (firstBuy.price - firstBuy.stop) * firstBuy.qty
        : null;
    const r = initialRisk !== null && initialRisk > 0 ? pnl / initialRisk : null;

    let pyramidContribution: number | null = null;
    if (firstBuy !== undefined && buys.length >= 2) {
      const sellQtyTotal = sells.reduce((acc, t) => acc + t.qty, 0);
      const avgExitPrice = sellQtyTotal > 0 ? sellProceeds / sellQtyTotal : 0;
      const virtualPnl = firstBuy.qty * (avgExitPrice - firstBuy.price);
      pyramidContribution = pnl - virtualPnl;
    }

    return {
      tickerId: ticker.id,
      tickerName: ticker.name,
      currency: ticker.currency,
      trades,
      startDate: trades[0].date,
      endDate: trades[trades.length - 1].date,
      stageCount: buys.length,
      pnl,
      initialRisk,
      r,
      reasonTags: uniqueReasonTags(trades),
      pyramidContribution,
      qtyMismatched: round.qtyMismatched,
    };
  });
}

/** 全銘柄分のクローズ済みラウンドを計算する(新しい順の並び替えは呼び出し側で行う)。 */
export function computeClosedRounds(tickers: Ticker[], trades: Trade[]): ClosedRound[] {
  return tickers.flatMap((ticker) => buildClosedRoundsForTicker(ticker, trades));
}

export interface CurrencySummary {
  currency: Currency;
  closedRoundCount: number;
  winCount: number;
  /** 勝率(0〜1)。closedRoundCount===0ならnull。 */
  winRate: number | null;
  /** プロフィットファクター = 総利益÷総損失。総損失が0(勝ちのみ)ならnull(allWinsNoLossesを見る)。 */
  profitFactor: number | null;
  /** 総損失0かつ総利益>0(全勝でPFが数値として定義できない)。 */
  allWinsNoLosses: boolean;
  /** R計算対象(stop宣言ありかつinitialRisk>0)のラウンド数。 */
  rEligibleCount: number;
  /** R計算対象外(stop未宣言またはinitialRisk<=0)のラウンド数。 */
  rExcludedCount: number;
  /** 平均R倍数(=R期待値。R計算対象ラウンドの単純平均)。対象0件ならnull。 */
  avgR: number | null;
  /** ピラミッディング(買い2段以上)したラウンド数。 */
  pyramidRoundCount: number;
  /** ピラミッディングしたラウンドの増し玉寄与の合計。対象0件ならnull。 */
  pyramidContributionTotal: number | null;
  /**
   * 数量不整合(保有数量を超える売り)のため集計から除外したラウンド数(Codex P2 + reviewer中3)。
   * `closedRoundCount`以下の各集計値にはこの件数分のラウンドを含めていない。
   */
  mismatchedCount: number;
}

/**
 * 指定通貨のラウンドだけを集計してサマリを作る(通貨は混ぜない。docs/design.md 増分9節)。
 * `qtyMismatched`(保有数量を超える売りがあったラウンド)はPF・勝率・R・増し玉寄与の
 * 集計対象から除外する(Codex P2 + reviewer中3。架空の勝ちラウンド・過大なpnlを計上しない)。
 */
export function summarizeByCurrency(rounds: ClosedRound[], currency: Currency): CurrencySummary {
  const scopedAll = rounds.filter((r) => r.currency === currency);
  const mismatchedCount = scopedAll.filter((r) => r.qtyMismatched).length;
  const scoped = scopedAll.filter((r) => !r.qtyMismatched);
  const closedRoundCount = scoped.length;
  const winCount = scoped.filter((r) => r.pnl > 0).length;
  const winRate = closedRoundCount > 0 ? winCount / closedRoundCount : null;

  const totalProfit = scoped.filter((r) => r.pnl > 0).reduce((acc, r) => acc + r.pnl, 0);
  const totalLoss = scoped.filter((r) => r.pnl < 0).reduce((acc, r) => acc + Math.abs(r.pnl), 0);
  const allWinsNoLosses = closedRoundCount > 0 && totalLoss === 0 && totalProfit > 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : null;

  const rEligible = scoped.filter((r) => r.r !== null);
  const rEligibleCount = rEligible.length;
  const rExcludedCount = closedRoundCount - rEligibleCount;
  const avgR =
    rEligibleCount > 0 ? rEligible.reduce((acc, r) => acc + (r.r as number), 0) / rEligibleCount : null;

  const pyramidRounds = scoped.filter((r) => r.pyramidContribution !== null);
  const pyramidRoundCount = pyramidRounds.length;
  const pyramidContributionTotal =
    pyramidRoundCount > 0
      ? pyramidRounds.reduce((acc, r) => acc + (r.pyramidContribution as number), 0)
      : null;

  return {
    currency,
    closedRoundCount,
    winCount,
    winRate,
    profitFactor,
    allWinsNoLosses,
    rEligibleCount,
    rExcludedCount,
    avgR,
    pyramidRoundCount,
    pyramidContributionTotal,
    mismatchedCount,
  };
}

export interface PassTagCount {
  /** プリセットタグ、または非プリセットタグの合算行(`OTHER_NON_PRESET_TAG_LABEL`)。 */
  tag: string;
  count: number;
}

/**
 * reviewer軽微L4: `storage.ts`の`isValidPassedEvent`はtagsを「任意の文字列配列」として
 * 寛容パースするため(プリセット外の文字列も生き残る)、集計を`PASS_REASON_TAG_PRESETS`の
 * mapだけで組み立てると非プリセットタグの件数が黙って消え、この画面の件数総和が実際の
 * 記録件数と食い違う。現時点でアプリからプリセット外タグを書く経路は無い(自由入力なし)が、
 * データ不整合(手動編集・インポート等)への安全側として、非プリセットタグは合算1行として
 * 表示に含める。
 */
export const OTHER_NON_PRESET_TAG_LABEL = "その他: 非プリセット";

/**
 * 見送り集計: 全銘柄のpassedEventsを合算し日付降順に並べ、直近20件(この画面独自の集計範囲。
 * 各銘柄のpassedEvents自体の保存上限20件<docs/design.md 増分7節>とは別)の範囲でタグ別件数を数える。
 * 0件のタグは結果に含めない。非プリセットタグは`OTHER_NON_PRESET_TAG_LABEL`へ合算する。
 */
export function computePassedEventTagCounts(tickers: Ticker[]): PassTagCount[] {
  const all: { date: string; tags: PassReasonTag[] }[] = [];
  for (const t of tickers) {
    for (const e of t.passedEvents ?? []) all.push(e);
  }
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = all.slice(0, 20);

  const presetSet: ReadonlySet<string> = new Set(PASS_REASON_TAG_PRESETS);
  const counts = new Map<string, number>();
  let otherCount = 0;
  for (const e of recent) {
    for (const tag of e.tags) {
      if (presetSet.has(tag)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      } else {
        otherCount += 1;
      }
    }
  }
  const rows: PassTagCount[] = PASS_REASON_TAG_PRESETS.map((tag) => ({
    tag,
    count: counts.get(tag) ?? 0,
  })).filter((c) => c.count > 0);
  if (otherCount > 0) rows.push({ tag: OTHER_NON_PRESET_TAG_LABEL, count: otherCount });
  return rows;
}
