#!/usr/bin/env bash
# metor smoke test – exercises a running computer (box) end to end from the host.
# Needs only Docker and the metor wrapper; curl and node run inside the container.
#
#   scripts/smoke.sh [--build] [--restart] [--no-chat] [--codex <bot>] [--keep]
#
#   --build     rebuild the image first (metor box build)
#   --restart   restart the container first and wait for every autostart bot to come back
#   --no-chat   skip the chat roundtrips (they spend subscription quota)
#   --codex X   use bot X for the Codex roundtrip (default: the first idle Codex bot, else skipped)
#   --keep      keep the probe bot instead of removing it at the end
#
# Exit code = number of failed checks. Every check prints "ok" or "FAIL".
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HERE/../backend/harness/bin:$PATH"
export C="${METOR_BOX_CONTAINER:-metor-box}"
export JAR=/tmp/smoke.jar JAR2=/tmp/smoke2.jar
PROBE="${SMOKE_BOT:-smoke}"
BUILD=0 RESTART=0 CHAT=1 KEEP=0 CODEX_BOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;; --restart) RESTART=1 ;; --no-chat) CHAT=0 ;; --keep) KEEP=1 ;;
    --codex) CODEX_BOT="$2"; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac; shift
done

FAILS=0; PASSES=0
ok()   { PASSES=$((PASSES + 1)); echo "ok   - $1"; }
fail() { FAILS=$((FAILS + 1)); echo "FAIL - $1${2:+ ($2)}"; }
check() { local desc=$1; shift; if "$@" >/dev/null 2>&1; then ok "$desc"; else fail "$desc"; fi; }
# Helpers – also usable inside `sub` (bash -c with the functions exported)
inbox()   { docker exec -i "$C" "$@"; }                       # run inside the container
G=http://127.0.0.1:6010
api()     { inbox curl -s -b "$JAR" "$G/bots/api$1"; }
apipost() { inbox curl -s -b "$JAR" -X POST -H "content-type: application/json" -d "$2" "$G/bots/api$1"; }
apicode() { inbox curl -s -b "$JAR" -o /dev/null -w "%{http_code}" "$G/bots/api$1"; }
rawcode() { inbox curl -s -o /dev/null -w "%{http_code}" "$@"; }   # status code of an arbitrary request
# JSON helper: node inside the container, the document on stdin, an expression over `j` as $1
jq_()     { inbox node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=eval(process.argv[1]);process.stdout.write(typeof r==="string"?r:JSON.stringify(r))})' "$1"; }
export -f inbox api apipost apicode rawcode jq_
export G
sub() { bash -c "$1"; }
statuses() { api /agents | jq_ 'j.map(a=>a.name+" "+a.status).join("\n")'; }
wait_for() { # wait_for <seconds> <description> <command…>: polls until the command succeeds
  local secs=$1 desc=$2; shift 2; local i=0
  while [ $i -lt "$secs" ]; do if "$@" >/dev/null 2>&1; then ok "$desc (${i}s)"; return 0; fi; sleep 2; i=$((i + 2)); done
  fail "$desc" "not within ${secs}s"; return 1
}
all_up() { ! statuses | grep -q " stopped$"; }
START_TS=$(date -u +%Y-%m-%dT%H:%M:%S)

echo "== metor smoke test ($(date '+%Y-%m-%d %H:%M'), container $C)"
[ $BUILD -eq 1 ] && { metor box build >/dev/null 2>&1 && ok "image built" || { fail "image build"; exit 1; }; }
if [ $RESTART -eq 1 ]; then
  metor box down >/dev/null 2>&1; metor box up >/dev/null 2>&1 && ok "container restarted" || fail "container restart"
  START_TS=$(date -u +%Y-%m-%dT%H:%M:%S); sleep 5
fi
docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null | grep -q true || { fail "container running"; exit 1; }
ok "container running ($(inbox metor version))"
wait_for 60 "gateway answers" sub '[ "$(rawcode $G/bots/api/harnesses)" != 000 ]'

# --- sign-in (ADR-0012): setup link, pairing code, revoke -----------------------------------
inbox rm -f "$JAR" "$JAR2"
AUTH_MODE=$(docker exec "$C" sh -c 'echo "${METOR_AUTH:-on}"')
if [ "$AUTH_MODE" != "off" ]; then
  check "unauthenticated API answers 401" sub '[ "$(rawcode $G/bots/api/agents)" = 401 ]'
  check "unauthenticated page is the sign-in page" sub 'inbox curl -s $G/bots/ | grep -q "auth/code"'
  check "WebSocket upgrade without a session is refused" sub '[ "$(rawcode -H "Connection: Upgrade" -H "Upgrade: websocket" $G/bots/nobody/websockify)" != 101 ]'
  # redeem the link against the local gateway, whatever public base URL it carries
  LINK=$(inbox metor auth link --plain 2>/dev/null | grep -o 'http[^ ]*claim?token=[^ ]*' | head -1 | sed "s|^https\{0,1\}://[^/]*|$G|")
  if [ -n "$LINK" ]; then ok "metor auth link prints a link"; else fail "metor auth link"; fi
  check "setup link signs this client in (302 + cookie)" sub "[ \"\$(inbox curl -s -o /dev/null -w '%{http_code}' -c $JAR '$LINK')\" = 302 ]"
  check "the link works only once" sub "[ \"\$(rawcode '$LINK')\" = 401 ]"
  check "GET /auth/me with the session" sub 'api /auth/me | grep -q "\"id\""'
  PAIR=$(apipost /auth/pair '{}')
  CODE=$(printf '%s' "$PAIR" | jq_ 'j.code??""')
  if [ -n "$CODE" ]; then ok "pairing code issued"; else fail "pairing" "$PAIR"; fi
  if printf '%s' "$PAIR" | grep -q '"qr":"data:image/png'; then ok "QR code rendered"; else fail "QR code"; fi
  check "pairing code signs a second client in" sub "[ \"\$(inbox curl -s -o /dev/null -w '%{http_code}' -c $JAR2 --data-urlencode code='$CODE' $G/bots/auth/code)\" = 302 ]"
  check "second client sees the API" sub "[ \"\$(inbox curl -s -o /dev/null -w '%{http_code}' -b $JAR2 $G/bots/api/agents)\" = 200 ]"
  check "wrong pairing code is refused" sub '[ "$(rawcode --data-urlencode code=XXXX-XXXX $G/bots/auth/code)" = 401 ]'
  SECOND=$(api /auth/sessions | jq_ 'j.filter(s=>!s.current).map(s=>s.id).pop()??""')
  check "device list shows the second device" sub '[ "$(api /auth/sessions | jq_ "j.length")" -ge 2 ]'
  check "revoke the second device" sub "[ \"\$(inbox curl -s -b $JAR -o /dev/null -w '%{http_code}' -X DELETE $G/bots/api/auth/sessions/$SECOND)\" = 200 ]"
  check "revoked device is out" sub "[ \"\$(inbox curl -s -o /dev/null -w '%{http_code}' -b $JAR2 $G/bots/api/agents)\" = 401 ]"
else
  echo "skip - METOR_AUTH=off: sign-in checks skipped"
fi

# --- autostart bots and API ---------------------------------------------------------------
wait_for 180 "every autostart bot is up" all_up
check "metor bot list" metor bot list
check "GET /agents is a JSON array" sub 'api /agents | jq_ "Array.isArray(j)?\"yes\":\"\"" | grep -q yes'
check "GET /harnesses lists the runtimes" sub 'api /harnesses | jq_ "j.map(h=>h.id).join(\",\")" | grep -q claude-stream'
check "SSE stream delivers the agents event" sub "inbox curl -sN --max-time 3 -b $JAR '$G/bots/api/events?topics=agents' | grep -q 'event: agents'"
check "unknown bot in the API is 404" sub '[ "$(apicode /agents/does-not-exist/routines)" = 404 ]'
check "reserved name in the API is 404" sub '[ "$(apicode /agents/api/routines)" = 404 ]'

# --- CLI error paths (must fail cleanly) ---------------------------------------------------
check "rm of a missing bot fails" bash -c "! metor bot rm does-not-exist"
check "reserved bot name is refused" bash -c "! metor bot create api --role x --no-start"
check "unknown runtime is refused" bash -c "! metor bot create $PROBE --role x --harness nope --no-start"
check "unknown model is refused" bash -c "! metor bot create $PROBE --role x --model nope --no-start"
check "refused creates leave no directory" bash -c "! docker exec $C test -e /workspace/bots/$PROBE"

# --- probe bot: create → watch → start → logs → stop → start → rm ------------------------
metor bot rm "$PROBE" >/dev/null 2>&1 || true
cleanup() { [ $KEEP -eq 1 ] || metor bot rm "$PROBE" >/dev/null 2>&1 || true; [ "$AUTH_MODE" = off ] || apipost /auth/logout '{}' >/dev/null 2>&1 || true; inbox rm -f "$JAR" "$JAR2" 2>/dev/null || true; }
trap cleanup EXIT
if metor bot create "$PROBE" --role "Smoke-test bot: answer briefly." --no-start >/dev/null 2>&1; then
  ok "create --no-start"
  check "bot.json and role file exist" inbox sh -c "test -f /workspace/bots/$PROBE/bot.json && test -f /workspace/bots/$PROBE/CLAUDE.md"
  check "watch prints the link" bash -c "metor bot watch $PROBE | grep -q '/bots/$PROBE/vnc.html'"
  if metor bot start "$PROBE" 2>&1 | grep -q "running (stream"; then ok "start"; else fail "start"; fi
  wait_for 60 "probe is idle with a complete desktop" bash -c "metor bot list | grep -E '^$PROBE +idle +:[0-9]+ '"
  check "logs shows the host log" bash -c "metor bot logs $PROBE | grep -q 'Host for $PROBE started'"
  check "watch-url and mcp.json were written" inbox sh -c "test -f /workspace/bots/$PROBE/.metor/watch-url && test -f /workspace/bots/$PROBE/mcp.json"
  check "screen page is proxied with the session" sub "[ \"\$(inbox curl -s -b $JAR -o /dev/null -w '%{http_code}' $G/bots/$PROBE/vnc.html)\" = 200 ]"
  if [ $CHAT -eq 1 ]; then
    WORD="SMOKE$RANDOM"
    R=$(apipost "/agents/$PROBE/chat/send" "{\"text\":\"Reply with exactly the word $WORD and nothing else.\",\"sendId\":\"smoke-$WORD\"}")
    echo "$R" | grep -q '"accepted":true' && ok "chat send accepted" || fail "chat send" "$R"
    wait_for 150 "Claude bot answered" sub "api /agents/$PROBE/chat/history | jq_ 'j.filter(x=>x.role===\"assistant\"&&x.kind===\"text\").some(x=>x.text.includes(\"$WORD\"))?\"yes\":\"\"' | grep -q yes"
    R=$(apipost "/agents/$PROBE/chat/send" "{\"text\":\"again\",\"sendId\":\"smoke-$WORD\"}")
    echo "$R" | grep -q '"duplicate":true' && ok "same sendId is deduplicated" || fail "sendId dedupe" "$R"
    check "status is reported for the probe" sub "api /agents | jq_ 'j.find(a=>a.name===\"$PROBE\").status' | grep -Eq 'idle|busy'"
  fi
  check "stop" bash -c "metor bot stop $PROBE | grep -q 'host stopped'"
  check "stopped bot is listed as stopped" bash -c "metor bot list | grep -E '^$PROBE +stopped '"
  # A session ID only exists after the first turn – without the chat roundtrip the restart is "new"
  if [ $CHAT -eq 1 ]; then check "start again resumes the session" bash -c "metor bot start $PROBE | grep -q 'running (stream, session [0-9a-f-]\{36\}'"
  else check "start again" bash -c "metor bot start $PROBE | grep -q 'running (stream, session new'"; fi
  if [ $KEEP -eq 0 ]; then
    check "rm" bash -c "metor bot rm $PROBE | grep -q removed"
    check "rm deleted the directory" bash -c "! docker exec $C test -e /workspace/bots/$PROBE"
  fi
else
  fail "create --no-start"
fi

# --- Codex roundtrip (optional) --------------------------------------------------------------
if [ $CHAT -eq 1 ]; then
  [ -z "$CODEX_BOT" ] && CODEX_BOT=$(api /agents | jq_ 'j.filter(a=>a.harness==="codex"&&a.status==="idle").map(a=>a.name)[0]??""')
  if [ -n "$CODEX_BOT" ]; then
    WORD="SMOKE$RANDOM"
    apipost "/agents/$CODEX_BOT/chat/send" "{\"text\":\"Reply with exactly the word $WORD and nothing else.\"}" >/dev/null
    wait_for 150 "Codex bot $CODEX_BOT answered" sub "api /agents/$CODEX_BOT/chat/history | jq_ 'j.filter(x=>x.role===\"assistant\"&&x.kind===\"text\").some(x=>x.text.includes(\"$WORD\"))?\"yes\":\"\"' | grep -q yes"
  else
    echo "skip - no idle Codex bot (use --codex <bot>)"
  fi
fi

# --- supervisor and host logs since the start of this run ----------------------------------
if docker logs --since "$START_TS" "$C" 2>&1 | grep -Eq "TypeError|ReferenceError|SyntaxError|Unhandled"; then
  fail "supervisor/gateway log has JavaScript errors"; else ok "no JavaScript errors in the supervisor log"; fi
if inbox sh -c "grep -l 'already running' /workspace/bots/*/.metor/host.log 2>/dev/null | xargs -r -I{} sh -c 'tail -3 {} | grep -q \"already running\" && echo {}'" | grep -q .; then
  fail "a host exited because of a running twin (see host.log)"; else ok "no double starts"; fi

echo "== $PASSES ok, $FAILS failed"
exit $FAILS
