import { STATUS_LABEL_JA, Ticker, TICKER_STATUSES, TickerStatus } from "../types";
import { kessanNaviUrl, jukyuNaviUrl } from "../lib/external";

interface Props {
  ticker: Ticker | undefined;
  onStatusChange: (id: string, status: TickerStatus) => void;
}

/** 銘柄IDを市場プレフィックスとコードに分ける。"JP:7203" -> ["JP", "7203"] */
function splitId(id: string): [string, string] {
  const idx = id.indexOf(":");
  if (idx === -1) return ["", id];
  return [id.slice(0, idx), id.slice(idx + 1)];
}

/** 銘柄カルテ画面(`#/ticker/<id>`)。銘柄の詳細と、旧アプリへの深掘りリンクを表示する。 */
export function TickerDetail({ ticker, onStatusChange }: Props) {
  if (!ticker) {
    return (
      <section class="ticker-detail">
        <a class="back-link" href="#/">
          ← 今日画面へ戻る
        </a>
        <p class="empty-state">この銘柄は見つかりません(削除された可能性があります)</p>
      </section>
    );
  }

  const [market, code] = splitId(ticker.id);

  return (
    <section class="ticker-detail">
      <a class="back-link" href="#/">
        ← 今日画面へ戻る
      </a>
      <h1>{ticker.name}</h1>
      <dl class="ticker-detail__meta">
        <dt>ID</dt>
        <dd>{ticker.id}</dd>
        <dt>通貨</dt>
        <dd>{ticker.currency}</dd>
        <dt>登録日</dt>
        <dd>{ticker.createdAt}</dd>
        <dt>更新日</dt>
        <dd>{ticker.updatedAt}</dd>
        {ticker.importedFrom && (
          <>
            <dt>インポート元</dt>
            <dd>{ticker.importedFrom}</dd>
          </>
        )}
      </dl>
      <label class="ticker-detail__status">
        状態
        <select
          value={ticker.status}
          onChange={(e) =>
            onStatusChange(ticker.id, (e.target as HTMLSelectElement).value as TickerStatus)
          }
        >
          {TICKER_STATUSES.map((s) => (
            <option value={s}>{STATUS_LABEL_JA[s]}</option>
          ))}
        </select>
      </label>
      <div class="ticker-detail__links">
        <h2>深掘りリンク</h2>
        {market === "JP" ? (
          <ul>
            <li>
              <a href={kessanNaviUrl(code)} target="_blank" rel="noopener noreferrer">
                決算ナビで見る
              </a>
            </li>
            <li>
              <a href={jukyuNaviUrl(code)} target="_blank" rel="noopener noreferrer">
                需給ナビで見る
              </a>
            </li>
          </ul>
        ) : (
          <p class="empty-state empty-state--small">US銘柄は深掘りリンクの対象外です</p>
        )}
      </div>
    </section>
  );
}
