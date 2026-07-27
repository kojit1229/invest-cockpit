// ポジションサイズ計算機(損小利大の建玉サイズ逆算)。増分7。
// 方針: 許容損失額とエントリー価格・stopから推奨株数を逆算する純関数。
// docs/design.md 増分7節の契約: 推奨株数 = floor(許容損失額 ÷ (エントリー価格 − stop))。
// JP銘柄は単元株(100株)単位に切り下げ、US銘柄は1株単位。

export interface PositionSizeInput {
  entryPrice: number;
  stop: number;
  riskAmount: number;
  /** "JP"は100株単位に切り下げ、"US"(またはそれ以外)は1株単位。 */
  market: string;
}

export interface PositionSizeResult {
  /** 単元株丸め済みの推奨株数(0未満にはならない)。 */
  qty: number;
  /** 丸め後の実際の最大損失額(qty * (entryPrice - stop))。 */
  maxLoss: number;
}

/**
 * 推奨株数を計算する。entryPriceがstop以下の場合はnullを返し、呼び出し側が
 * 「stopはエントリーより下に」というエラー表示をする(docs/design.md 増分7節)。
 */
export function recommendPositionSize(input: PositionSizeInput): PositionSizeResult | null {
  const { entryPrice, stop, riskAmount, market } = input;
  if (!(entryPrice > stop)) return null;
  const perShareLoss = entryPrice - stop;
  const unit = market === "JP" ? 100 : 1;
  const rawQty = Math.floor(riskAmount / perShareLoss);
  const qty = Math.max(0, Math.floor(rawQty / unit) * unit);
  return { qty, maxLoss: qty * perShareLoss };
}
