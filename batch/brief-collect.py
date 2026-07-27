#!/usr/bin/env python
"""brief-collect.py — invest-koro-brief(引け後ブリーフ)用の入力データ収集。

personal-data の invest-cockpit/state.json(銘柄・建玉・stop・見送り履歴)を読み、
決算ナビ・需給ナビの公開JSON(GitHub Pages本番)をfetchして、AIプロンプト用の
コンテキストJSONと、ヘルスチェック用のフラグJSONを書き出す。

設計の正典: repos/invest-cockpit/docs/design.md (h)節・(j)節(URL・スキーマの根拠)、
.claude/skills/ai-linked-app-dev/SKILL.md「信頼性:静かに壊れない」節(ソース単位の失敗隔離)。

state.jsonが存在しない(private repo同期がまだ行われていない端末状態)ことはエラーでは
ない。その場合は空のtickersとして続行し、health.state=falseで記録する(フェイルソフト。
ネットワーク・claude呼び出しの失敗とは性質が異なるため、本スクリプト自体はexit 0のまま)。

使い方: brief-collect.py <state_json_path> <context_out.json> <health_out.json>
"""
import json
import sys
import urllib.error
import urllib.request

KESSAN_SCHEDULE_URL = "https://kojit1229.github.io/stock_analyze/frontend/data/schedule.json"
KESSAN_META_URL = "https://kojit1229.github.io/stock_analyze/frontend/data/meta.json"
JUKYU_PRICES_META_URL = "https://kojit1229.github.io/stock_supply_demand/data/prices_meta.json"
JUKYU_PRICE_URL_TMPL = "https://kojit1229.github.io/stock_supply_demand/data/prices/{code}.json"

# 判断キュー(design.md (h))と同じスコープ: sold/passedは判断済みとして対象外。
ACTIVE_STATUSES = {"candidate", "watching", "holding"}

FETCH_TIMEOUT_SEC = 15


def fetch_json(url):
    """成功時はパース済みJSONを、失敗時はNoneを返す(ソース単位の失敗隔離。例外を投げない)。"""
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            if resp.status != 200:
                return None
            body = resp.read().decode("utf-8")
        return json.loads(body)
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError):
        return None


def load_state(path):
    """state.jsonを寛容パースする。存在しない/壊れている場合はNoneを返す(呼び出し側で空状態扱い)。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def extract_tickers(state):
    """state.jsonのtickers/tradesから、対象(active status)銘柄のプロンプト用コンテキストを作る。"""
    tickers_raw = state.get("tickers") if isinstance(state, dict) else None
    trades_raw = state.get("trades") if isinstance(state, dict) else None
    if not isinstance(tickers_raw, list):
        tickers_raw = []
    if not isinstance(trades_raw, list):
        trades_raw = []

    tickers = []
    jp_codes = []
    for t in tickers_raw:
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        status = t.get("status")
        if not isinstance(tid, str) or not tid or status not in ACTIVE_STATUSES:
            continue

        t_trades = []
        for tr in trades_raw:
            if isinstance(tr, dict) and tr.get("tickerId") == tid:
                t_trades.append({
                    "side": tr.get("side"),
                    "date": tr.get("date"),
                    "qty": tr.get("qty"),
                    "price": tr.get("price"),
                    "stop": tr.get("stop"),
                    "reasonTags": tr.get("reasonTags") if isinstance(tr.get("reasonTags"), list) else [],
                })

        passed_events = t.get("passedEvents")
        if not isinstance(passed_events, list):
            passed_events = []

        tickers.append({
            "id": tid,
            "name": t.get("name"),
            "currency": t.get("currency"),
            "status": status,
            "trades": t_trades,
            "recentPassedEvents": passed_events[-3:],
        })

        if tid.startswith("JP:"):
            code = tid.split(":", 1)[1]
            if code:
                jp_codes.append(code)

    return tickers, jp_codes


def main(argv):
    if len(argv) != 4:
        print(
            "使い方: brief-collect.py <state_json_path> <context_out.json> <health_out.json>",
            file=sys.stderr,
        )
        return 2
    state_path, context_out, health_out = argv[1], argv[2], argv[3]

    state = load_state(state_path)
    state_ok = state is not None
    tickers, jp_codes = extract_tickers(state or {})

    # ---- 決算ナビ: schedule + meta の両方が取れて初めてkessan=true ----
    schedule = fetch_json(KESSAN_SCHEDULE_URL)
    kessan_meta = fetch_json(KESSAN_META_URL)
    kessan_ok = schedule is not None and kessan_meta is not None
    schedule_filtered = []
    if isinstance(schedule, list) and jp_codes:
        code_set = set(jp_codes)
        schedule_filtered = [
            s for s in schedule
            if isinstance(s, dict) and s.get("code") in code_set
        ]

    # ---- 需給ナビ: prices_metaが取れて初めてjukyu=true。銘柄別pricesは個別に失敗隔離 ----
    prices_meta = fetch_json(JUKYU_PRICES_META_URL)
    jukyu_ok = prices_meta is not None
    prices = {}
    for code in jp_codes:
        p = fetch_json(JUKYU_PRICE_URL_TMPL.format(code=code))
        if p is not None:
            prices[code] = p

    context = {
        "state_available": state_ok,
        "tickers": tickers,
        "kessan": {
            "available": kessan_ok,
            "schedule": schedule_filtered,
            "meta": kessan_meta,
        },
        "jukyu": {
            "available": jukyu_ok,
            "prices_meta": prices_meta,
            "prices": prices,
        },
    }
    with open(context_out, "w", encoding="utf-8") as f:
        json.dump(context, f, ensure_ascii=False, indent=2)

    health = {"kessan": kessan_ok, "jukyu": jukyu_ok, "state": state_ok}
    with open(health_out, "w", encoding="utf-8") as f:
        json.dump(health, f, ensure_ascii=False)

    print(
        f"state={state_ok} kessan={kessan_ok} jukyu={jukyu_ok} "
        f"tickers={len(tickers)} jp_codes={len(jp_codes)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
