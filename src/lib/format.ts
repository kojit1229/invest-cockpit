// 表示用の金額フォーマット(増分3)。内部計算はnumberのまま扱い、丸めは表示直前のみ行う。

import { Currency } from "../types";

const SYMBOL_BY_CURRENCY: Record<Currency, string> = {
  JPY: "¥",
  USD: "$",
};

// 通貨別の表示桁数(reviewer中8): JPYは整数、USDは小数点2桁。整数丸め固定だとNVDA等の
// USD建て銘柄で$123.45が$123に丸まり実害があるため、通貨ごとに桁数を切り替える
// (docs/design.md 増分3節(f)の契約を同時改訂)。
const DECIMALS_BY_CURRENCY: Record<Currency, number> = {
  JPY: 0,
  USD: 2,
};

/** 通貨記号のみを返す(増分7: ポジションサイズ計算機の入力欄ラベルで使う)。 */
export function currencySymbol(currency: Currency): string {
  return SYMBOL_BY_CURRENCY[currency];
}

/** 金額を通貨記号付き・通貨別の桁数(JPY=0桁/USD=2桁)で丸めた表示文字列にする。 */
export function formatMoney(amount: number, currency: Currency): string {
  const decimals = DECIMALS_BY_CURRENCY[currency];
  const rounded = Number(amount.toFixed(decimals));
  const text = rounded.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${SYMBOL_BY_CURRENCY[currency]}${text}`;
}
