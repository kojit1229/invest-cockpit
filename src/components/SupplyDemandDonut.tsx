// 増分8: 需給ドーナツ(売り圧vs買い圧)。契約はdocs/design.md (j)節。
// ライブラリ追加禁止のためSVGを自前描画する。弧の長さは固定の左右半分割りではなく、
// 買い合計・売り合計それぞれの全体に対する実比率で描く(この増分の実装判断、design.md参照)。

import {
  classifySupplyDemand,
  diffArrow,
  JUDGMENT_LABEL_JA,
  sumQty,
  SupplyDemandSegment,
  SupplyDemandSourceError,
} from "../lib/supplyDemand";

interface Props {
  buy: SupplyDemandSegment[];
  sell: SupplyDemandSegment[];
  errors: SupplyDemandSourceError[];
}

// moomooの配色慣習(赤=買い)に合わせる確定方針。売り側は3セグメントを濃淡3段階の緑で区別する。
const BUY_COLOR = "#c0392b";
const SELL_COLORS = ["#1e6b3c", "#2f9e5c", "#7fcf9e"];

const SIZE = 200;
const CENTER = SIZE / 2;
const OUTER_R = 90;
const INNER_R = 56;

interface Arc {
  key: string;
  color: string;
  d: string;
}

/** 中心(cx,cy)・角度startDeg〜endDeg(12時起点、時計回り)のドーナツ弧のpath dを作る。 */
function donutArcPath(cx: number, cy: number, startDeg: number, endDeg: number): string {
  // 1セグメントで100%(360度)になる退化ケースを避けるため、わずかに満たない値に丸める。
  const span = Math.min(endDeg - startDeg, 359.999);
  const clampedEnd = startDeg + span;
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const point = (r: number, deg: number) => [cx + r * Math.cos(toRad(deg)), cy + r * Math.sin(toRad(deg))];
  const largeArc = span > 180 ? 1 : 0;
  const [ox1, oy1] = point(OUTER_R, startDeg);
  const [ox2, oy2] = point(OUTER_R, clampedEnd);
  const [ix2, iy2] = point(INNER_R, clampedEnd);
  const [ix1, iy1] = point(INNER_R, startDeg);
  return [
    `M ${ox1} ${oy1}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${ix1} ${iy1}`,
    "Z",
  ].join(" ");
}

function buildArcs(buy: SupplyDemandSegment[], sell: SupplyDemandSegment[]): Arc[] {
  const total = sumQty(buy) + sumQty(sell);
  if (total <= 0) return [];
  const ordered: { key: string; qty: number; color: string }[] = [
    ...buy.map((s) => ({ key: s.key, qty: s.qty, color: BUY_COLOR })),
    ...sell.map((s, i) => ({ key: s.key, qty: s.qty, color: SELL_COLORS[i % SELL_COLORS.length] })),
  ];
  let cursor = 0;
  const arcs: Arc[] = [];
  for (const seg of ordered) {
    if (seg.qty <= 0) continue;
    const span = (seg.qty / total) * 360;
    arcs.push({ key: seg.key, color: seg.color, d: donutArcPath(CENTER, CENTER, cursor, cursor + span) });
    cursor += span;
  }
  return arcs;
}

function formatQty(qty: number): string {
  return `${qty.toLocaleString()}株`;
}

function LegendRow({ segment, color }: { segment: SupplyDemandSegment; color: string }) {
  const arrow = diffArrow(segment.diff);
  const diffText =
    segment.diff === null
      ? "(比較データなし)"
      : `${arrow}${Math.abs(segment.diff).toLocaleString()}株(${segment.diffPeriod === "week" ? "前週比" : "前日比"})`;
  return (
    <li class="supply-demand-donut__legend-row">
      <span class="supply-demand-donut__swatch" style={{ background: color }} />
      <span class="supply-demand-donut__legend-main">
        <span class="supply-demand-donut__legend-label">{segment.label}</span>
        <span class="supply-demand-donut__legend-value">
          {formatQty(segment.qty)} {diffText}
        </span>
        <span class="supply-demand-donut__legend-date">{segment.asOf}時点</span>
      </span>
    </li>
  );
}

/** 需給ドーナツ本体(SVG自前描画)+凡例+中央ラベル。銘柄カルテの需給セクションで使う。 */
export function SupplyDemandDonut({ buy, sell, errors }: Props) {
  const buyTotal = sumQty(buy);
  const sellTotal = sumQty(sell);

  if (buy.length === 0 && sell.length === 0) {
    if (errors.length >= 3) {
      return <p class="empty-state empty-state--small">取得不可(ローカル機能は正常)</p>;
    }
    return <p class="empty-state empty-state--small">需給データなし</p>;
  }

  const arcs = buildArcs(buy, sell);
  const judgment = classifySupplyDemand(buyTotal, sellTotal);
  const ratioText = sellTotal > 0 ? `信用倍率 ${(buyTotal / sellTotal).toFixed(2)}倍` : "信用倍率 —";

  return (
    <div class="supply-demand-donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="需給ドーナツ">
        {arcs.map((arc) => (
          <path key={arc.key} d={arc.d} fill={arc.color} />
        ))}
        <text x={CENTER} y={CENTER - 6} text-anchor="middle" class="supply-demand-donut__center-label">
          {JUDGMENT_LABEL_JA[judgment]}
        </text>
        <text x={CENTER} y={CENTER + 14} text-anchor="middle" class="supply-demand-donut__center-ratio">
          {ratioText}
        </text>
      </svg>
      <ul class="supply-demand-donut__legend">
        {buy.map((s) => (
          <LegendRow key={s.key} segment={s} color={BUY_COLOR} />
        ))}
        {sell.map((s, i) => (
          <LegendRow key={s.key} segment={s} color={SELL_COLORS[i % SELL_COLORS.length]} />
        ))}
      </ul>
      {errors.length > 0 && (
        <p class="supply-demand-donut__errors">
          {errors.map((e) => `取得不可: ${e.label}`).join(" / ")}
        </p>
      )}
    </div>
  );
}
