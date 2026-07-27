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
