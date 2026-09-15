#!/usr/bin/env bash
# Push the macOS signing + notarization secrets for desktop.yml to this repo.
#
#   tools/set-apple-secrets.sh --dry-run   # encrypt against the repo key, store nothing
#   tools/set-apple-secrets.sh             # push, with a confirmation
#   tools/set-apple-secrets.sh --yes       # no prompt
#
# Values come from the signing vault (see the software-signing skill), via
# value_of() in its copy-secret.sh -- sourced, not duplicated, so a rotation there
# is picked up here. desktop.yml uses the APPLE_* names Tauri expects; the vault
# uses MACOS_*, so this is only a name map. Values travel through STDIN, never
# --body (argv is visible via ps and lands in history), and are never printed.
set -euo pipefail

REPO=okohlbacher/mzpeakviewer   # hard rule: this repo only
VAULT="$HOME/Documents/Admin/Software Signing/OpenMS/FASTag"

DRY=0 YES=0
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    --yes|-y)     YES=1 ;;
    *) sed -n '2,6p' "$0"; exit 2 ;;
  esac
done

[ -f "$VAULT/copy-secret.sh" ] || { echo "vault not found: $VAULT" >&2; exit 1; }
# shellcheck source=/dev/null
. "$VAULT/copy-secret.sh"                  # value_of(); cds into the vault
cd - >/dev/null

# desktop.yml secret  <-  vault name
MAP=(
  APPLE_CERTIFICATE:MACOS_CERTIFICATE_BASE64
  APPLE_CERTIFICATE_PASSWORD:MACOS_CERTIFICATE_PASSWORD
  KEYCHAIN_PASSWORD:MACOS_KEYCHAIN_PASSWORD
  APPLE_SIGNING_IDENTITY:MACOS_SIGNING_IDENTITY
  APPLE_ID:MACOS_APPLE_ID
  APPLE_TEAM_ID:MACOS_TEAM_ID
  APPLE_APP_SPECIFIC_PASSWORD:MACOS_NOTARY_PASSWORD
)
val() { (cd "$VAULT" && value_of "$1"); }

gh auth status >/dev/null 2>&1 || { echo "run \`gh auth login\` first" >&2; exit 1; }
EXISTING=$(gh secret list -R "$REPO" --json name -q '.[].name')

# Refuse values that are visibly wrong (each one cost a debugging session elsewhere).
fail=0
notary=$(val MACOS_NOTARY_PASSWORD)
[[ "$notary" =~ ^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$ ]] \
  || { echo "REFUSED notary password: ${#notary} chars, want xxxx-xxxx-xxxx-xxxx" >&2; fail=1; }
case "$(val MACOS_SIGNING_IDENTITY)" in
  *"($(val MACOS_TEAM_ID))"*) ;;
  *) echo "REFUSED signing identity: does not name team $(val MACOS_TEAM_ID)" >&2; fail=1 ;;
esac
# OpenSSL 3 needs -legacy for macOS .p12 exports; without it a good password looks wrong.
openssl pkcs12 -legacy -in "$VAULT/developerID_application.p12" -noout \
    -passin file:"$VAULT/p12_password.txt" 2>/dev/null \
  || { echo "REFUSED certificate: .p12 does not open with p12_password.txt" >&2; fail=1; }
[ "$fail" = 0 ] || exit 1

printf 'to %s:\n' "$REPO"
for m in "${MAP[@]}"; do
  gh_name=${m%%:*} v=$(val "${m#*:}")
  [ -n "$v" ] || { echo "  $gh_name: empty in vault" >&2; exit 1; }
  printf '  %-28s %-7s %d bytes\n' "$gh_name" \
    "$(grep -qx "$gh_name" <<<"$EXISTING" && echo update || echo create)" "${#v}"
done

if [ "$DRY" = 1 ]; then
  for m in "${MAP[@]}"; do
    val "${m#*:}" | gh secret set "${m%%:*}" -R "$REPO" --no-store >/dev/null
  done
  echo "dry run ok -- all 7 encrypt against $REPO; nothing stored."
  exit 0
fi

if [ "$YES" != 1 ]; then
  read -rp "push 7 secrets to $REPO? [y/N] " r
  [[ "$r" == [yY]* ]] || { echo aborted; exit 1; }
fi
for m in "${MAP[@]}"; do
  val "${m#*:}" | gh secret set "${m%%:*}" -R "$REPO"
done
gh secret list -R "$REPO"
echo "Now rebuild with signing: gh run rerun 34886312876"
