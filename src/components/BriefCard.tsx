// 増分10: 引け後ブリーフカード(今日画面の判断キュー直下)。
// 契約: docs/design.md 増分10節。ブリーフ本文はstateに保存しない(表示のみ)。
// AI生成のcounterpointに対する採否(参考になった/却下)はappend-onlyでstateへ記録する
// (src/app.tsx handleBriefFeedback)。

import { Brief, BriefCounterpoint, briefFeedbackTextPrefix } from "../lib/brief";
import { daysBetween } from "../lib/date";
import { BriefFeedback, Ticker } from "../types";
import { tickerHref } from "../lib/router";

interface Props {
  /** null = ブリーフ未取得(トークン未設定・全日程404・取得失敗)。カード自体を出さない。 */
  brief: Brief | null;
  today: string;
  tickers: Ticker[];
  briefFeedback: BriefFeedback[];
  onDecide: (input: {
    date: string;
    tickerId: string | null;
    stance: string;
    text: string;
    verdict: "adopted" | "dismissed";
  }) => void;
}

// reviewer軽微L1: 以前は3だった。loadBrief(src/lib/brief.ts LOOKBACK_DAYS=2)は
// 今日→前日→前々日の3日分しか試行しないため、daysBetween(as_of, today)は最大2にしか
// ならず「> 3」は到達不能なデッドコードだった(design.mdの記載自体も自己矛盾)。
// この警告の実質的な意図は「フォールバックで古い日のブリーフを表示している」ことを
// 知らせることなので、閾値を0にしてフォールバック発生時に必ず表示されるようにする。
const STALE_THRESHOLD_DAYS = 0;

const STANCE_CLASS: Record<string, string> = {
  反対意見: "oppose",
  見落とし: "miss",
  確認事項: "check",
};

function findFeedback(
  feedback: BriefFeedback[],
  date: string,
  tickerId: string | null,
  stance: string,
  text: string,
): BriefFeedback | undefined {
  const prefix = briefFeedbackTextPrefix(text);
  return feedback.find(
    (f) => f.date === date && f.tickerId === tickerId && f.stance === stance && f.textPrefix === prefix,
  );
}

function CounterpointItem({
  cp,
  brief,
  tickers,
  briefFeedback,
  onDecide,
}: {
  cp: BriefCounterpoint;
  brief: Brief;
  tickers: Ticker[];
  briefFeedback: BriefFeedback[];
  onDecide: Props["onDecide"];
}) {
  const ticker = tickers.find((t) => t.id === cp.tickerId);
  const storedTickerId = cp.tickerId.trim() === "" ? null : cp.tickerId;
  const existing = findFeedback(briefFeedback, brief.as_of, storedTickerId, cp.stance, cp.text);

  function decide(verdict: "adopted" | "dismissed") {
    onDecide({ date: brief.as_of, tickerId: storedTickerId, stance: cp.stance, text: cp.text, verdict });
  }

  return (
    <li class="brief-card__item">
      <div class="brief-card__item-head">
        <span class={`brief-card__stance brief-card__stance--${STANCE_CLASS[cp.stance] ?? "other"}`}>
          {cp.stance}
        </span>
        {ticker ? (
          <a class="brief-card__ticker-link" href={tickerHref(ticker.id)}>
            {ticker.name}
          </a>
        ) : (
          <span class="brief-card__ticker-id">{cp.tickerId}</span>
        )}
      </div>
      <p class="brief-card__text">{cp.text}</p>
      <ul class="brief-card__basis">
        {cp.basis.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <div class="brief-card__actions">
        <button
          type="button"
          class="brief-card__adopt-btn"
          disabled={!!existing}
          onClick={() => decide("adopted")}
        >
          参考になった
        </button>
        <button
          type="button"
          class="brief-card__dismiss-btn"
          disabled={!!existing}
          onClick={() => decide("dismissed")}
        >
          却下
        </button>
        {existing && (
          <span class="brief-card__verdict">
            {existing.verdict === "adopted" ? "採用済み" : "却下済み"}
          </span>
        )}
      </div>
    </li>
  );
}

/** 引け後ブリーフカード(増分10)。brief===nullなら何も出さない(判断キューを邪魔しない)。 */
export function BriefCard({ brief, today, tickers, briefFeedback, onDecide }: Props) {
  if (!brief) return null;

  const stale = daysBetween(brief.as_of, today) > STALE_THRESHOLD_DAYS;

  return (
    <section class="brief-card">
      <div class="brief-card__header">
        <h2>引け後ブリーフ</h2>
        <span class="brief-card__badge">AI生成</span>
      </div>
      <p class="brief-card__date">
        {brief.as_of}
        {stale && <span class="brief-card__stale"> (古いブリーフ)</span>}
      </p>
      <p class="brief-card__summary">{brief.summary}</p>
      {brief.counterpoints.length === 0 ? (
        <p class="empty-state empty-state--small">指摘事項はありません</p>
      ) : (
        <ul class="brief-card__list">
          {brief.counterpoints.map((cp, i) => (
            <CounterpointItem
              cp={cp}
              brief={brief}
              tickers={tickers}
              briefFeedback={briefFeedback}
              onDecide={onDecide}
              key={`${cp.tickerId}:${cp.stance}:${i}`}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
