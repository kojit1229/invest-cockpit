#!/usr/bin/env bash
# brief.sh — 投資航路(invest-cockpit)増分10a: 引け後ブリーフ(AI反対意見つき)生成バッチ。
#
# アプリ側の決定論部(今日の判断キュー、src/lib/events.ts)とは別に、Kの高値ブレイク
# 順張り・損小利大スタイルを前提として「強気の後押しをしない」反対意見・見落とし・
# 確認事項だけをAIに出させ、personal-dataリポジトリへ日付入りJSONとして保存する
# (.claude/skills/ai-linked-app-dev/SKILL.md のファイル契約パターン踏襲)。
#
# AI不達・不正出力の場合はファイルを出さずexit 1(フェイルラウド)。ブリーフが無くても
# アプリの決定論部(判断キュー等)は動き続ける非対称設計を維持する(ブリーフを握りつぶさない
# が、無くてもアプリを壊さない)。
#
# スケジューラ登録は未承認・手動実行のみ(workspace CLAUDE.md NEVER 10。schtasks登録は
# 別途K承認が必要)。
#
# 出力ファイル契約(監督者確定・変更禁止): personal-data の
#   `invest-cockpit/brief/YYYY-MM-DD.json`
#   { schema_version, as_of, generated_at, generated_by:"ai", model, summary,
#     counterpoints:[{tickerId,stance,text,basis}], health:{sources:{kessan,jukyu,state}} }
#
# 入力: personal-data の `invest-cockpit/state.json`(無ければ空状態として続行し
#       health.state=falseで記録する。private repo同期がまだ行われていない端末状態は
#       正常系として扱う)+ 決算ナビ/需給ナビの公開JSON(GitHub Pages本番)。
#
# 使い方:
#   brief.sh              予算確認→state.json/公開JSON収集→AI生成→検証→personal-dataへpush
#   brief.sh --dry-run    git pull・公開JSON取得・claude呼び出し・pushをせず、ダミーデータで
#                          検証の配線だけを確認する
#   brief.sh --force      当日分が既に存在しても上書きする
set -uo pipefail

# Windows(anaconda Python)のcp932既定エンコーディング事故を避ける(python-cp932-gotcha)。
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

# ROOTはワークスペースルート(ClaudeCode/)。このスクリプトは
# ClaudeCode/repos/invest-cockpit/batch/brief.sh に置く前提。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/loop/scripts"
BATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECT_PY="$BATCH_DIR/brief-collect.py"
VALIDATE_PY="$BATCH_DIR/brief-validate.py"
PROMPT_FILE="$BATCH_DIR/brief-prompt.md"

CLAUDE_BIN="${CLAUDE_BIN:-claude}"
BRIEF_MODEL="${BRIEF_MODEL:-claude-sonnet-5}"
BRIEF_BUDGET="${BRIEF_BUDGET:-1.00}"
KEEP_DAYS="${BRIEF_KEEP_DAYS:-14}"

PERSONAL_REPO="${PERSONAL_REPO:-$ROOT/repos/personal-data}"
PDATA="$PERSONAL_REPO/invest-cockpit"
STATE_FILE="$PDATA/state.json"
BRIEF_SUBDIR="invest-cockpit/brief"

log() { echo "[invest-koro-brief] $*"; }
die() { echo "[invest-koro-brief] ERROR: $*" >&2; exit 1; }

DRY_RUN=0
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    *) die "不明な引数: $1" ;;
  esac
done

# ---------- 多重起動防止(analyze-kessan.shと同じPIDロックファイル方式) ----------
LOCK_FILE="$ROOT/memory/collect/invest-koro-brief.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
if [ -f "$LOCK_FILE" ]; then
  OLD_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    log "多重起動防止: 既に実行中(PID $OLD_PID)のためスキップして終了します"
    exit 0
  fi
  log "古いロックファイルを検出(PID ${OLD_PID:-不明} は生存していません)。上書きします"
fi
echo "$$" > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

TODAY="$(date +%Y-%m-%d)"
OUT_NAME="$TODAY.json"
OUT_PATH="$PDATA/brief/$OUT_NAME"

WORK_DIR="$ROOT/memory/collect/$(date +%Y%m%d-%H%M%S)-invest-koro-brief"
mkdir -p "$WORK_DIR"

CONTEXT_JSON="$WORK_DIR/context.json"
HEALTH_JSON="$WORK_DIR/health.json"
CANDIDATE_JSON="$WORK_DIR/candidate.json"

if [ "$DRY_RUN" -eq 0 ]; then
  # ---------- 冪等チェック(実行時のみ。--forceで上書き) ----------
  if [ -f "$OUT_PATH" ] && [ "$FORCE" -ne 1 ]; then
    log "既に本日分のブリーフが存在するためスキップ(冪等): $OUT_PATH"
    exit 0
  fi

  [ -d "$PERSONAL_REPO/.git" ] || die "個人データrepoが無い: $PERSONAL_REPO"
  if ! git -C "$PERSONAL_REPO" pull --ff-only >"$WORK_DIR/pull.log" 2>&1; then
    die "git pull --ff-only に失敗(詳細: $WORK_DIR/pull.log)"
  fi
  log "pull完了: $(tail -1 "$WORK_DIR/pull.log")"
  mkdir -p "$PDATA/brief"

  # ---------- 予算確認(workspace CLAUDE.md NEVER 8)。超過は今回スキップ(queueへは積まない) ----------
  if ! bash "$SCRIPTS/cost-check.sh" --budget "$BRIEF_BUDGET" --stage "invest-koro-brief"; then
    log "当日予算(\$$BRIEF_BUDGET)超過のため今回はスキップする(次回実行に委ねる)"
    exit 0
  fi

  # ---------- 入力収集(state.json + 公開JSON。ソース単位で失敗隔離) ----------
  if ! collect_summary="$(python "$COLLECT_PY" "$STATE_FILE" "$CONTEXT_JSON" "$HEALTH_JSON" 2>"$WORK_DIR/collect.stderr.log")"; then
    die "入力収集に失敗(詳細: $WORK_DIR/collect.stderr.log)"
  fi
  log "収集完了: $collect_summary"

  [ -f "$PROMPT_FILE" ] || die "プロンプトファイルが無い: $PROMPT_FILE"

  prompt_input="$WORK_DIR/prompt.input.txt"
  {
    cat "$PROMPT_FILE"
    echo
    echo "対象日(as_of): $TODAY"
    echo
    echo "---- 入力データ(state.json抽出 + 決算ナビ/需給ナビ公開JSON) ----"
    cat "$CONTEXT_JSON"
  } >"$prompt_input"

  # ---------- claude 呼び出し(JSON生成のみのためツール不要。--allowedTools ""で全無効化) ----------
  raw="$WORK_DIR/claude.raw.json"
  if ! "$CLAUDE_BIN" -p --model "$BRIEF_MODEL" --output-format json --allowedTools "" <"$prompt_input" >"$raw" 2>"$WORK_DIR/claude.stderr.log"; then
    die "claude 呼び出しが失敗(非0終了。詳細: $WORK_DIR/claude.stderr.log)"
  fi

  # ---------- is_error/空応答/非JSONをすべてフェイルラウドで検出する ----------
  is_error="$(python -c "import json,sys
try:
    d=json.load(open(sys.argv[1],encoding='utf-8'))
    print(bool(d.get('is_error', False)))
except Exception:
    print('PARSE_ERROR')" "$raw")"
  if [ "$is_error" != "False" ]; then
    die "claude の応答が不正、またはis_error=trueだった(詳細: $raw)"
  fi

  cost="$(python -c "import json,sys
try:
    d=json.load(open(sys.argv[1],encoding='utf-8'))
    print(d.get('total_cost_usd',0))
except Exception:
    print(0)" "$raw")"
  case "$cost" in
    ''|*[!0-9.]*|*.*.*) log "コスト値が不正のため記録スキップ(値: '${cost}')" ;;
    *) bash "$SCRIPTS/log-cost.sh" "invest-koro-brief" "$cost"; log "cost=\$${cost}" ;;
  esac

  python -c "import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
r=d.get('result','')
sys.stdout.write(r if isinstance(r,str) else json.dumps(r,ensure_ascii=False))" "$raw" >"$WORK_DIR/result.raw.txt" 2>"$WORK_DIR/result.extract.stderr.log"
  if [ ! -s "$WORK_DIR/result.raw.txt" ]; then
    die "claude の result が空(詳細: $WORK_DIR/result.extract.stderr.log)"
  fi

  # ---------- resultからJSONオブジェクトを取り出す(コードフェンス混入への保険) ----------
  if ! python -c "
import json, re, sys
raw = open(sys.argv[1], encoding='utf-8').read()
try:
    obj = json.loads(raw)
except ValueError:
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if not m:
        print('JSONオブジェクトが見つからない', file=sys.stderr)
        sys.exit(1)
    obj = json.loads(m.group(0))
with open(sys.argv[2], 'w', encoding='utf-8') as f:
    json.dump(obj, f, ensure_ascii=False)
" "$WORK_DIR/result.raw.txt" "$CANDIDATE_JSON" 2>"$WORK_DIR/candidate.extract.stderr.log"; then
    die "claude resultからのJSON抽出に失敗(非JSON応答。詳細: $WORK_DIR/candidate.extract.stderr.log)"
  fi
else
  # ---------- dry-run: ネットワークfetch・claude呼び出しをせず、ダミーデータで配線だけ検証する ----------
  log "dry-run: git pull・公開JSON取得・claude呼び出しをすべてスキップする"
  cat >"$HEALTH_JSON" <<'JSON'
{"kessan": true, "jukyu": true, "state": true}
JSON
  cat >"$CANDIDATE_JSON" <<'JSON'
{
  "summary": "【DRY-RUN】検証用ダミーの市況総括です。",
  "counterpoints": [
    {
      "tickerId": "JP:0000",
      "stance": "確認事項",
      "text": "【DRY-RUN】検証用ダミーの指摘です。",
      "basis": ["【DRY-RUN】ダミーの根拠"]
    }
  ]
}
JSON
  log "dry-run: ダミーhealth($HEALTH_JSON)とダミーcandidate($CANDIDATE_JSON)を生成した"
fi

# ---------- 検証(dry-run/実行共通。不正ならファイルを出さずexit 1) ----------
if ! FINAL_JSON="$(python "$VALIDATE_PY" "$CANDIDATE_JSON" "$TODAY" "$HEALTH_JSON" "$BRIEF_MODEL")"; then
  die "生成JSONの検証に失敗(詳細は上のログ参照)。ファイルは出さない"
fi
log "検証OK"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "$FINAL_JSON" >"$WORK_DIR/$OUT_NAME.dryrun"
  log "dry-run完了: $WORK_DIR/$OUT_NAME.dryrun に検証済みJSONを書いた(personal-dataへは書かない)"
  exit 0
fi

# ---------- 検証OK: personal-data/invest-cockpit/brief/ へ書く ----------
printf '%s\n' "$FINAL_JSON" >"$OUT_PATH"
log "ブリーフ生成完了: $OUT_PATH"

# ---------- 保持 $KEEP_DAYS 日、古い分は同コミットでgit rm ----------
(
  cd "$PDATA/brief" || exit 1
  files="$(ls -1 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$' | sort || true)"
  if [ -n "$files" ]; then
    total="$(printf '%s\n' "$files" | grep -c .)"
    if [ "$total" -gt "$KEEP_DAYS" ]; then
      to_delete="$(printf '%s\n' "$files" | head -n $((total - KEEP_DAYS)))"
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        git -C "$PERSONAL_REPO" rm --quiet -- "$BRIEF_SUBDIR/$f" 2>/dev/null || rm -f "$f"
        log "古いブリーフを削除(保持は直近${KEEP_DAYS}日分): $f"
      done <<<"$to_delete"
    fi
  fi
)

# ---------- path限定push(二重防御): brief/以外の変更を検出したら中止する ----------
# --untracked-files=all必須: 初回のように invest-cockpit/ 配下がまだ何も追跡されていない
# 場合、既定の--porcelainは新規ディレクトリを "?? invest-cockpit/" と1行に畳んでしまい、
# ファイル単位のpath判定(以下のgrep)を誤検知させる(2026-07-27 実行テストで発見)。
CHANGED="$(git -C "$PERSONAL_REPO" status --porcelain --untracked-files=all)"
if [ -z "$CHANGED" ]; then
  log "個人データ側は変更なし。commitしない"
  exit 0
fi
OUTSIDE="$(echo "$CHANGED" | awk '{print $2}' | grep -v "^${BRIEF_SUBDIR}/" || true)"
if [ -n "$OUTSIDE" ]; then
  die "invest-cockpit/brief/ 以外の変更を検出したためpushしない(ファイル自体は $OUT_PATH に保存済み): $OUTSIDE"
fi

git -C "$PERSONAL_REPO" add "$BRIEF_SUBDIR"
if git -C "$PERSONAL_REPO" diff --cached --quiet; then
  log "ステージ後に差分なし。commitしない"
  exit 0
fi
if ! git -C "$PERSONAL_REPO" commit -m "$(cat <<EOF
invest-koro-brief: $TODAY のAIブリーフを追加(自動生成)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" >"$WORK_DIR/commit.log" 2>&1; then
  die "commit に失敗(ファイル自体は $OUT_PATH に保存済み、詳細: $WORK_DIR/commit.log)"
fi
if ! git -C "$PERSONAL_REPO" push >"$WORK_DIR/push.log" 2>&1; then
  die "push に失敗(commit済み、詳細: $WORK_DIR/push.log)"
fi

log "brief.sh 完了: $(git -C "$PERSONAL_REPO" log --oneline -1)"
