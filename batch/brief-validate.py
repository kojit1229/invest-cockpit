#!/usr/bin/env python
"""brief-validate.py — invest-koro-brief生成物のスキーマ検証(標準ライブラリのみ)。

AIの出力(candidate: summary + counterpoints)を検証し、決定論フィールド
(schema_version / as_of / generated_at / generated_by / model / health)を合成した
最終JSONを標準出力へ書く。スキーマ不正はexit 1・標準エラーへ理由を書き、標準出力には
何も書かない(呼び出し側=brief.shはexit code!=0のときファイルを書かない。フェイルラウド)。

スキーマの正典: 発注時に確定した仕様(brief.sh冒頭コメント参照)。
  { schema_version, as_of, generated_at, generated_by:"ai", model, summary,
    counterpoints:[{tickerId,stance,text,basis}], health:{sources:{kessan,jukyu,state}} }

使い方: brief-validate.py <candidate_json_path> <as_of YYYY-MM-DD> <health_json_path> <model名>
"""
import datetime
import json
import re
import sys

VALID_STANCES = {"反対意見", "見落とし", "確認事項"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_TEXT_LEN = 200
MAX_SUMMARY_LINES = 3
# reviewer軽微L2: 以前はtext 200字のみに上限があり、counterpoints件数・basis要素数・
# basis各要素の長さ・summary文字数(行数のみ制限)には上限が無かった。暴走したモデル出力が
# そのままpersonal-dataへ入る余地を塞ぐ。
MAX_SUMMARY_LEN = 600
MAX_COUNTERPOINTS = 10
MAX_BASIS_ITEMS = 5
MAX_BASIS_LEN = 200


def fail(msg):
    print(f"[brief-validate] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_json_file(path, label):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        fail(f"{label}の読み込みに失敗: {e}")


def main(argv):
    if len(argv) != 5:
        fail("使い方: brief-validate.py <candidate_json> <as_of> <health_json> <model>")
    _, candidate_path, as_of, health_path, model = argv

    if not DATE_RE.match(as_of):
        fail(f"as_ofの形式が不正(YYYY-MM-DD想定): {as_of}")

    candidate = load_json_file(candidate_path, "candidate JSON")
    if not isinstance(candidate, dict):
        fail("candidateがJSONオブジェクトでない")

    summary = candidate.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        fail("summaryが空、または文字列でない")
    if len(summary) > MAX_SUMMARY_LEN:
        fail(f"summaryが{MAX_SUMMARY_LEN}字を超えている({len(summary)}字)")
    summary_lines = [line for line in summary.splitlines() if line.strip()]
    if len(summary_lines) > MAX_SUMMARY_LINES:
        fail(f"summaryが{MAX_SUMMARY_LINES}行を超えている({len(summary_lines)}行)")

    counterpoints = candidate.get("counterpoints")
    if not isinstance(counterpoints, list):
        fail("counterpointsが配列でない")
    if len(counterpoints) > MAX_COUNTERPOINTS:
        fail(f"counterpointsが{MAX_COUNTERPOINTS}件を超えている({len(counterpoints)}件)")

    # reviewer軽微L2: AIが返した未知キーをそのまま最終JSONへ通さない。既知フィールドのみで
    # 再構築する(将来フィールドを増やす際の暗黙の前提を無くす。既存のXSS経路は無いことは
    # 確認済みだが、personal-dataに入るデータの形は本スキーマが正典であるべき)。
    clean_counterpoints = []
    for i, cp in enumerate(counterpoints):
        if not isinstance(cp, dict):
            fail(f"counterpoints[{i}]がオブジェクトでない")
        ticker_id = cp.get("tickerId")
        if not isinstance(ticker_id, str) or not ticker_id.strip():
            fail(f"counterpoints[{i}].tickerIdが空、または文字列でない")
        stance = cp.get("stance")
        if stance not in VALID_STANCES:
            fail(f"counterpoints[{i}].stanceが不正: {stance!r}")
        text = cp.get("text")
        if not isinstance(text, str) or not text.strip():
            fail(f"counterpoints[{i}].textが空、または文字列でない")
        if len(text) > MAX_TEXT_LEN:
            fail(f"counterpoints[{i}].textが{MAX_TEXT_LEN}字を超えている({len(text)}字)")
        basis = cp.get("basis")
        if not isinstance(basis, list) or len(basis) < 1:
            fail(f"counterpoints[{i}].basisが空、または配列でない(1件以上必須)")
        if len(basis) > MAX_BASIS_ITEMS:
            fail(f"counterpoints[{i}].basisが{MAX_BASIS_ITEMS}件を超えている({len(basis)}件)")
        for j, b in enumerate(basis):
            if not isinstance(b, str) or not b.strip():
                fail(f"counterpoints[{i}].basis[{j}]が空、または文字列でない")
            if len(b) > MAX_BASIS_LEN:
                fail(f"counterpoints[{i}].basis[{j}]が{MAX_BASIS_LEN}字を超えている({len(b)}字)")
        clean_counterpoints.append(
            {"tickerId": ticker_id, "stance": stance, "text": text, "basis": list(basis)}
        )

    health = load_json_file(health_path, "health JSON")
    if not isinstance(health, dict):
        fail("healthがオブジェクトでない")
    sources = {}
    for key in ("kessan", "jukyu", "state"):
        val = health.get(key)
        if not isinstance(val, bool):
            fail(f"health.{key}がbool でない: {val!r}")
        sources[key] = val

    if not isinstance(model, str) or not model.strip():
        fail("modelが空")

    final = {
        "schema_version": 1,
        "as_of": as_of,
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "generated_by": "ai",
        "model": model,
        "summary": summary,
        "counterpoints": clean_counterpoints,
        "health": {"sources": sources},
    }
    print(json.dumps(final, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
