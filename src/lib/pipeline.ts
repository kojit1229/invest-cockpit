// 増分5: 決算ナビ・需給ナビの公開JSONを読み、決定論イベント判定の入力データを作る。
// 契約: docs/design.md 増分5節。
// 方針: ソースごとに独立してfetch・失敗を隔離する(決算ナビが落ちても需給ナビは使う、逆も同様)。
// 保存はしない(ロードのたびにクライアント側で計算する)。壊れたデータ・404は例外を投げず
// null/エラーフラグで表現し、呼び出し側(app.tsx)がフォールバック表示を決める。

export interface EarningsScheduleEntry {
  code: string;
  /** YYYY-MM-DD */
  date: string;
  fiscal_type: string;
}

export interface PriceSeries {
  code: string;
  weekly: { dates: string[]; close: (number | null)[] };
  daily: { dates: string[]; close: (number | null)[] };
}

export interface PipelineData {
  /** 決算ナビ: 決算発表予定(取得・検証に失敗した場合はnull)。 */
  schedule: EarningsScheduleEntry[] | null;
  /** 決算ナビのデータ日付(meta.jsonのgenerated_atから切り出したYYYY-MM-DD。失敗ならnull)。 */
  kessanAsOf: string | null;
  /** 需給ナビ: 銘柄コード(市場プレフィックス無し)-> 株価シリーズ。取得できた銘柄のみ入る。 */
  prices: Map<string, PriceSeries>;
  /** 需給ナビのデータ日付(prices_meta.jsonのlatest_price_date。失敗ならnull)。 */
  jukyuAsOf: string | null;
  /** ソースごとの取得失敗フラグ(UIの「取得不可」表示に使う)。 */
  errors: { kessan: boolean; jukyu: boolean };
}

// 本番はGitHub Pages同一オリジン(kojit1229.github.io)で解決されるルート相対パス。
// devでは404になるが正常(呼び出し側がフォールバック表示する。docs/design.md 増分5節)。
const KESSAN_SCHEDULE_URL = "/stock_analyze/data/schedule.json";
const KESSAN_META_URL = "/stock_analyze/data/meta.json";
const JUKYU_PRICES_META_URL = "/stock_supply_demand/data/prices_meta.json";

function jukyuPriceUrl(code: string): string {
  return `/stock_supply_demand/data/prices/${encodeURIComponent(code)}.json`;
}

/** fetch+JSON parseをまとめて例外にしない(ネットワークエラー・404・非JSON応答はnull)。 */
async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function isValidScheduleEntry(v: unknown): v is EarningsScheduleEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.code === "string" &&
    typeof o.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.date) &&
    typeof o.fiscal_type === "string"
  );
}

async function loadKessan(): Promise<{
  schedule: EarningsScheduleEntry[] | null;
  asOf: string | null;
  error: boolean;
}> {
  const [scheduleRaw, metaRaw] = await Promise.all([fetchJson(KESSAN_SCHEDULE_URL), fetchJson(KESSAN_META_URL)]);

  const schedule = Array.isArray(scheduleRaw) ? scheduleRaw.filter(isValidScheduleEntry) : null;

  let asOf: string | null = null;
  if (typeof metaRaw === "object" && metaRaw !== null) {
    const generatedAt = (metaRaw as Record<string, unknown>).generated_at;
    // meta.jsonのgenerated_atは"YYYY-MM-DDTHH:mm:ss"形式。new Date()には渡さず、
    // 先頭10文字の文字列切り出しだけでYYYY-MM-DD部分を得る。
    if (typeof generatedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(generatedAt)) {
      asOf = generatedAt.slice(0, 10);
    }
  }

  // scheduleが取れなければソース失敗扱い(asOfだけ取れても決算判定はできないため)。
  return { schedule, asOf, error: schedule === null };
}

function isValidPriceSeries(v: unknown, code: string): v is PriceSeries {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.code !== code) return false;
  const w = o.weekly as Record<string, unknown> | undefined;
  const d = o.daily as Record<string, unknown> | undefined;
  return (
    typeof w === "object" &&
    w !== null &&
    Array.isArray(w.dates) &&
    Array.isArray(w.close) &&
    typeof d === "object" &&
    d !== null &&
    Array.isArray(d.dates) &&
    Array.isArray(d.close)
  );
}

async function loadJukyuPrices(codes: string[]): Promise<{
  prices: Map<string, PriceSeries>;
  asOf: string | null;
  error: boolean;
}> {
  const metaRaw = await fetchJson(JUKYU_PRICES_META_URL);
  let asOf: string | null = null;
  let metaError = true;
  if (typeof metaRaw === "object" && metaRaw !== null) {
    const latest = (metaRaw as Record<string, unknown>).latest_price_date;
    if (typeof latest === "string") {
      asOf = latest;
      metaError = false;
    }
  }

  const prices = new Map<string, PriceSeries>();
  if (codes.length > 0) {
    const results = await Promise.all(
      codes.map(async (code) => {
        const raw = await fetchJson(jukyuPriceUrl(code));
        return isValidPriceSeries(raw, code) ? raw : null;
      }),
    );
    for (const r of results) {
      if (r) prices.set(r.code, r);
    }
  }

  // 鮮度の基準であるprices_meta.jsonが読めない場合はソース全体を失敗扱いにする
  // (個別のprices/{code}.jsonだけ取れても「出典の日付」が表示できないため)。
  return { prices, asOf, error: metaError };
}

/** 決算ナビ・需給ナビの公開JSONを読み、イベント判定の入力データを作る。jpCodesは市場プレフィックス無しのコード。 */
export async function loadPipelineData(jpCodes: string[]): Promise<PipelineData> {
  const uniqueCodes = Array.from(new Set(jpCodes));
  const [kessan, jukyu] = await Promise.all([loadKessan(), loadJukyuPrices(uniqueCodes)]);
  return {
    schedule: kessan.schedule,
    kessanAsOf: kessan.asOf,
    prices: jukyu.prices,
    jukyuAsOf: jukyu.asOf,
    errors: { kessan: kessan.error, jukyu: jukyu.error },
  };
}
