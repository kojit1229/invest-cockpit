// 建玉(ピラミッディング段階)の導出。増分3。
// 方針: 建玉はstateに保存せず、Tradeの一覧から毎回この純関数で計算する(docs/design.md 増分3節)。

import { Trade } from "../types";

/** 買いtrade1件 = ピラミッディング段階1件。直近のフラット(建玉解消)以降のみを対象とする。 */
export interface PositionStage {
  trade: Trade;
  /** 1始まりの段数(直近フラット以降、古い買いから順)。 */
  stage: number;
}

export interface Position {
  /** 保有数量。買い合計-売り合計。負値にはならない(売り超過は0でクランプ)。 */
  qty: number;
  /** 平均取得単価(買いの加重平均、売りは平均単価法で数量のみ減らす)。qty===0ならnull。 */
  avgPrice: number | null;
  /** 買いtradeの一覧(直近のフラット以降、古い順、段数付き)。前ラウンド(過去にフラットになる前)の買いは含まない。 */
  stages: PositionStage[];
  /** 直近のフラット以降のtradeで宣言された最新のstop。フラット以降に一度も宣言されていなければnull(前ラウンドのstopは持ち越さない)。 */
  currentStop: number | null;
  /** 損切り到達時の想定損失額 = (avgPrice - currentStop) * qty。qty===0またはcurrentStop未宣言ならnull。 */
  stopLossAmount: number | null;
}

/** ラウンド1件分のtrade一覧(日付→createdAt→id順にソート済み)。closed=trueは保有数量が0に戻って終了したラウンド。 */
export interface Round {
  trades: Trade[];
  closed: boolean;
  /**
   * 保有数量を超える売り(フラット時の単独売りを含む)が1件でもあったか(Codex P2 + reviewer中3)。
   * データ不整合(買いの削除・誤入力等)の兆候であり、このラウンドのpnl・R・増し玉寄与は
   * 信頼できない。`src/lib/review.ts`はこのフラグが立つラウンドをPF・勝率・R・増し玉寄与の
   * 集計から除外し、UI(`ReviewPage.tsx`)はラウンド一覧に警告タグ付きで表示する
   * (黙って架空の損益を計上しない)。建玉計算(`computePosition`)自体は従来どおり0でクランプする。
   */
  qtyMismatched: boolean;
}

/** 日付→createdAt→idの順で安定ソートする(同日の複数取引でも導出結果を決定的にする)。 */
function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 対象銘柄のtradeを、保有数量が0になった時点(フラット=建玉解消)を境界にラウンド単位へ分割する。
 * `computePosition`(建玉導出)と`src/lib/review.ts`(週次レビューのラウンド集計)の両方が、
 * ラウンド境界の基準としてこの関数を共通利用する(重複実装によるズレを防ぐ。docs/design.md 増分9節)。
 * 最後のラウンドが一度もフラットに達していなければ(=現在も保有中)`closed: false`で返す。
 */
export function splitRounds(allTrades: Trade[], tickerId: string): Round[] {
  const trades = sortTrades(allTrades.filter((t) => t.tickerId === tickerId));
  const rounds: Round[] = [];
  let current: Trade[] = [];
  let qty = 0;
  let qtyMismatched = false;

  for (const t of trades) {
    current.push(t);
    if (t.side === "buy") {
      qty += t.qty;
    } else {
      // 保有数量を超える売り(フラット時の単独売り含む)は数量不整合として記録する
      // (Codex P2 + reviewer中3)。0でのクランプ自体は従来どおり(マイナス建玉は作らない)。
      if (t.qty > qty) qtyMismatched = true;
      qty = Math.max(0, qty - t.qty);
    }
    if (qty === 0) {
      rounds.push({ trades: current, closed: true, qtyMismatched });
      current = [];
      qtyMismatched = false;
    }
  }
  if (current.length > 0) {
    rounds.push({ trades: current, closed: false, qtyMismatched });
  }
  return rounds;
}

/**
 * 指定銘柄の建玉を、その銘柄のTrade一覧から導出する。tradesは全銘柄分を渡してよい(内部でtickerId絞り込みする)。
 *
 * ラウンド境界(reviewer重大4の修正、増分9で`splitRounds`へ抽出): 保有数量が0になった時点
 * (フラット=建玉解消)を新ラウンドの開始点とし、`stages`・`currentStop`はそのフラット以降の
 * tradeだけから導出する。直近ラウンドが未クローズ(`closed: false`)でなければ建玉なし(qty:0)を
 * 返す。フラットにした売り自体がstopを宣言していても、そのstopは(建玉が無くなった時点のもの
 * なので)次ラウンドへ持ち越さない(次ラウンドのtradeにそのtradeは含まれないため自然にリセット
 * される)。
 */
export function computePosition(allTrades: Trade[], tickerId: string): Position {
  const rounds = splitRounds(allTrades, tickerId);
  const openRound = rounds.length > 0 && !rounds[rounds.length - 1].closed ? rounds[rounds.length - 1] : null;

  if (openRound === null) {
    return { qty: 0, avgPrice: null, stages: [], currentStop: null, stopLossAmount: null };
  }

  let qty = 0;
  let avgPrice = 0; // qty>0の間だけ意味を持つ。
  const stages: PositionStage[] = [];
  let currentStop: number | null = null;
  let stageNo = 0;

  for (const t of openRound.trades) {
    if (t.side === "buy") {
      const newQty = qty + t.qty;
      avgPrice = newQty > 0 ? (qty * avgPrice + t.qty * t.price) / newQty : 0;
      qty = newQty;
      stageNo += 1;
      stages.push({ trade: t, stage: stageNo });
    } else {
      // 売り超過(データ不整合や手動削除の結果ありうる)は0でクランプし、マイナス建玉を作らない。
      // openRound内でqtyが0になることは無い(0になった時点でsplitRoundsがラウンドを閉じるため)。
      qty = Math.max(0, qty - t.qty);
    }
    if (t.stop !== undefined) {
      currentStop = t.stop;
    }
  }

  const stopLossAmount = qty > 0 && currentStop !== null ? (avgPrice - currentStop) * qty : null;

  return {
    qty,
    avgPrice: qty > 0 ? avgPrice : null,
    stages,
    currentStop,
    stopLossAmount,
  };
}
