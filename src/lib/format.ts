// 表示用の金額フォーマット(増分3)。内部計算はnumberのまま扱い、丸めは表示直前のみ行う。

import { Currency } from "../types";

const SYMBOL_BY_CURRENCY: Record<Currency, string> = {
  JPY: "¥",
  USD: "$",
};

/** 金額を通貨記号付き・整数丸めの表示文字列にする。 */
export function formatMoney(amount: number, currency: Currency): string {
  return `${SYMBOL_BY_CURRENCY[currency]}${Math.round(amount).toLocaleString()}`;
}
