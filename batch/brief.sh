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
# 重要(reviewer重大R1): このpushフロー(personal-data/invest-cockpit/brief/への自動commit・push)は
# `loop/standing-flows.md` の NEVER 9 白名単に未登録・K承認待ち。承認まで実行しない。
# 承認を得たら白名単へ追記すること(その際、旧版にあった保持14日分の`git rm`は
# 「作成系のみ」の白名単境界を越えるため、削除処理自体は既にこのスクリプトから除去済み。
# 保持方針(古いブリーフの扱い)はK承認後に別途再設計する)。
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
# KEEP_DAYS(保持日数)は無し: 旧版は保持14日超をgit rmしていたが、personal-dataへの
# 削除系操作はNEVER 9白名単外のため削除した(reviewer重大R1)。再設計はK承認後に別途行う。

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
  [ -d "$PERSONAL_REPO/.git" ] || die "個人データrepoが無い: $PERSONAL_REPO"
  if ! git -C "$PERSONAL_REPO" pull --ff-only >"$WORK_DIR/pull.log" 2>&1; then
    die "git pull --ff-only に失敗(詳細: $WORK_DIR/pull.log)"
  fi
  log "pull完了: $(tail -1 "$WORK_DIR/pull.log")"
  mkdir -p "$PDATA/brief"

  # ---------- 冪等チェック(M1: git pullの後に置く。他マシンで既に生成・push済みの当日分を
  # 上書き生成しないようにする。pull前に置くと、ローカルにまだ当日ファイルが無いだけの
  # 状態で無条件に再生成へ進んでしまう) ----------
  if [ -f "$OUT_PATH" ] && [ "$FORCE" -ne 1 ]; then
    # M1: 前回実行が「commit済みだがpush失敗」で死んだ場合、当日ファイルはローカルに
    # 存在し続けるため、単純な存在チェックだけだと以後永久にスキップされ二度とpushされない。
    # ローカルHEADにこのファイルへのcommitがあり、かつそれが上流(リモート追跡ブランチ)へ
    # まだ届いていない場合を区別し、生成(claude呼び出し)はやり直さずpushだけ再試行する。
    UNPUSHED="$(git -C "$PERSONAL_REPO" log --oneline '@{u}..HEAD' -- "$BRIEF_SUBDIR/$OUT_NAME" 2>/dev/null || true)"
    if [ -n "$UNPUSHED" ]; then
      log "ローカルに当日分のcommit済みブリーフがあるがリモート未反映のため、生成をスキップしpushだけ再試行する: $OUT_PATH"
      if ! git -C "$PERSONAL_REPO" push >"$WORK_DIR/push.log" 2>&1; then
        die "push再試行に失敗(commit済み、詳細: $WORK_DIR/push.log)"
      fi
      log "push再試行に成功: $(git -C "$PERSONAL_REPO" log --oneline -1)"
      exit 0
    fi
    log "既に本日分のブリーフが存在するためスキップ(冪等): $OUT_PATH"
    exit 0
  fi

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

# ---------- 保持ロジック(削除)について(reviewer重大R1 + CLAUDE.md NEVER 9) ----------
# 旧版はここで保持14日を超えた古いブリーフをgit rmしていたが、personal-dataへの
# 削除系操作はNEVER 9の白名単((b)「作成系のみ」)の境界外のため削除した。保持方針の
# 再設計(削除するか・何日分か)はK承認後に別途行う。それまで古いブリーフはpersonal-data
# 側に増え続ける(削除しないこと自体は安全側)。

# ---------- path限定push(二重防御): brief/以外の変更を検出したら中止する ----------
# --untracked-files=all必須: 初回のように invest-cockpit/ 配下がまだ何も追跡されていない
# 場合、既定の--porcelainは新規ディレクトリを "?? invest-cockpit/" と1行に畳んでしまい、
# ファイル単位のpath判定を誤検知させる(2026-07-27 実行テストで発見)。
#
# reviewer軽微L3: 以前は非-zの`--porcelain`出力を`awk '{print $2}'`で切り出していたため、
# パスに空白を含む場合にフィールドが分断される余地があった(誤判定は常に「範囲外」扱いへの
# 安全側フォールトのため実害は無かったが、堅牢な方式へ置き換える)。-z(NUL区切り・パスを
# クォートしない)でgitの出力を直接process substitution経由で読み、変数へは格納しない
# (bashの変数はNULバイトを保持できずcommand substitutionで消えるため、$()には入れない)。
# rename/copy(ステータス先頭2文字にR/Cを含む)はNUL区切りの直後にもう1フィールド(旧パス)
# が続くため、それも判定対象に含める。
ANY_CHANGE=0
OUTSIDE=""
while IFS= read -r -d '' entry; do
  ANY_CHANGE=1
  status="${entry:0:2}"
  path="${entry:3}"
  case "$path" in
    "${BRIEF_SUBDIR}/"*) ;;
    *) OUTSIDE="${OUTSIDE}${path}"$'\n' ;;
  esac
  case "$status" in
    *R*|*C*)
      IFS= read -r -d '' orig_path || orig_path=""
      case "$orig_path" in
        "${BRIEF_SUBDIR}/"*) ;;
        *) OUTSIDE="${OUTSIDE}${orig_path}"$'\n' ;;
      esac
      ;;
  esac
done < <(git -C "$PERSONAL_REPO" status --porcelain -z --untracked-files=all)

if [ "$ANY_CHANGE" -eq 0 ]; then
  log "個人データ側は変更なし。commitしない"
  exit 0
fi
if [ -n "$OUTSIDE" ]; then
  die "invest-cockpit/brief/ 以外の変更を検出したためpushしない(ファイル自体は $OUT_PATH に保存済み): $(printf '%s' "$OUTSIDE" | tr '\n' ' ')"
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
