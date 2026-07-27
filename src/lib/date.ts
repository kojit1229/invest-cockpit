// iOS Safari対応: `new Date("YYYY-MM-DD")` のような文字列パースは使わない(数値分解でDate構築)。
// 参照: .claude/skills/ai-linked-app-dev/SKILL.md、taskchute-journal Skillの既知の罠。

/** 現在日時から YYYY-MM-DD 文字列を生成する(ローカルタイムゾーン基準)。 */
export function todayStr(): string {
  const d = new Date();
  return formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** 現在時刻から YYYY-MM-DDTHH:mm:ss 文字列を生成する(ローカルタイムゾーン基準)。 */
export function nowStr(): string {
  const d = new Date();
  const date = formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return `${date}T${time}`;
}

export function formatDateParts(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** "YYYY-MM-DD"を年/月/日の数値に分解する(new Date(文字列)によるパースを避けるため)。 */
function parseYmd(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split("-").map(Number);
  return [y, m, d];
}

/**
 * 2つの"YYYY-MM-DD"文字列の日数差(b - a)を返す。bがaより未来なら正、過去なら負。
 * 文字列をそのままDateへ渡さず、年/月/日に数値分解してからDate.UTCで構築する
 * (iOS Safari対策。増分5: 決算接近・鮮度判定で使う)。
 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parseYmd(a);
  const [by, bm, bd] = parseYmd(b);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / msPerDay);
}

/**
 * "YYYY-MM-DD"からn日前(nが負なら未来)の"YYYY-MM-DD"を返す。daysBetween同様、
 * 文字列をそのままDateへ渡さずDate.UTC経由で計算する(増分8: 需給ドーナツの
 * 前週比・前日比の比較対象日を推測するために使う。過去分ファイルの一覧を取得する
 * 手段が無いため、休日でズレる可能性がある日付を推測して個別にfetchし、
 * 404なら「比較データなし」にフォールバックする方式を前提とする)。
 */
export function subtractDays(dateStr: string, n: number): string {
  const [y, m, d] = parseYmd(dateStr);
  const msPerDay = 24 * 60 * 60 * 1000;
  const t = Date.UTC(y, m - 1, d) - n * msPerDay;
  const dt = new Date(t);
  return formatDateParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
