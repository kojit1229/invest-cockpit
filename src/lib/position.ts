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

/** 日付→createdAt→idの順で安定ソートする(同日の複数取引でも導出結果を決定的にする)。 */
function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 指定銘柄の建玉を、その銘柄のTrade一覧から導出する。tradesは全銘柄分を渡してよい(内部でtickerId絞り込みする)。
 *
 * ラウンド境界(reviewer重大4の修正): 保有数量が0になった時点(フラット=建玉解消)を新ラウンドの
 * 開始点とし、`stages`・`currentStop`はそのフラット以降のtradeだけから導出する。フラットにした
 * 売り自体がstopを宣言していても、そのstopは(建玉が無くなった時点のものなので)次ラウンドへ
 * 持ち越さずnullにリセットする。`avgPrice`は元々qty===0で0にリセットされるため、新ラウンドの
 * 買いから自然に正しい値が積み上がる(この点はフラット判定を待たずに従来から正しい)。
 */
export function computePosition(allTrades: Trade[], tickerId: string): Position {
  const trades = sortTrades(allTrades.filter((t) => t.tickerId === tickerId));

  let qty = 0;
  let avgPrice = 0; // qty>0の間だけ意味を持つ。qty===0では0にリセットする。
  let stages: PositionStage[] = [];
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
      if (qty === 0) {
        avgPrice = 0;
        // フラット到達: 新ラウンドの開始点として段数・stopをリセットする(前ラウンドの遺物を残さない)。
        // このフラットを起こした売りが同時にstopを宣言していても、建玉が無くなった以上そのstopは
        // 次ラウンドに引き継がない(continueで下のstop反映をスキップする)。
        stages = [];
        currentStop = null;
        stageNo = 0;
        continue;
      }
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
