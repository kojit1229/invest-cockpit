// 建玉(ピラミッディング段階)の導出。増分3。
// 方針: 建玉はstateに保存せず、Tradeの一覧から毎回この純関数で計算する(docs/design.md 増分3節)。

import { Trade } from "../types";

/** 買いtrade1件 = ピラミッディング段階1件。 */
export interface PositionStage {
  trade: Trade;
  /** 1始まりの段数(古い買いから順)。 */
  stage: number;
}

export interface Position {
  /** 保有数量。買い合計-売り合計。負値にはならない(売り超過は0でクランプ)。 */
  qty: number;
  /** 平均取得単価(買いの加重平均、売りは平均単価法で数量のみ減らす)。qty===0ならnull。 */
  avgPrice: number | null;
  /** 買いtradeの一覧(古い順、段数付き)。 */
  stages: PositionStage[];
  /** 最新のstop宣言。一度も宣言されていなければnull。 */
  currentStop: number | null;
  /** 損切り到達時の想定損失額 = (avgPrice - currentStop) * qty。qty===0またはcurrentStop未宣言ならnull。 */
  stopLossAmount: number | null;
}

/** 日付→createdAt→idの順で安定ソートする(同日の複数取引でも導出結果を決定的にする)。 */
function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 指定銘柄の建玉を、その銘柄のTrade一覧から導出する。tradesは全銘柄分を渡してよい(内部でtickerId絞り込みする)。 */
export function computePosition(allTrades: Trade[], tickerId: string): Position {
  const trades = sortTrades(allTrades.filter((t) => t.tickerId === tickerId));

  let qty = 0;
  let avgPrice = 0; // qty>0の間だけ意味を持つ。qty===0では0にリセットする。
  const stages: PositionStage[] = [];
  let currentStop: number | null = null;
  let stageNo = 0;

  for (const t of trades) {
    if (t.side === "buy") {
      const newQty = qty + t.qty;
      avgPrice = newQty > 0 ? (qty * avgPrice + t.qty * t.price) / newQty : 0;
      qty = newQty;
      stageNo += 1;
      stages.push({ trade: t, stage: stageNo });
    } else {
      // 売り超過(データ不整合や手動削除の結果ありうる)は0でクランプし、マイナス建玉を作らない。
      qty = Math.max(0, qty - t.qty);
      if (qty === 0) avgPrice = 0;
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
