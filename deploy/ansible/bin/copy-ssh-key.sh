#!/usr/bin/env bash
# Before provisioning: put this machine's ssh key to `provision_user` (root) of every server in group "malina".
# A server that already lets us in by key is skipped; otherwise ssh-copy-id asks that server's password once.
#   bin/copy-ssh-key.sh [limit]          (make provisioning runs it)
# Env: INVENTORY — another inventory file; SSH_KEY — public key (default: ~/.ssh/id_ed25519.pub, id_ecdsa.pub, id_rsa.pub)
set -euo pipefail
cd "$(dirname "$0")/.."

key="${SSH_KEY:-}"
if [ -z "$key" ]; then
  for k in ~/.ssh/id_ed25519.pub ~/.ssh/id_ecdsa.pub ~/.ssh/id_rsa.pub; do [ -f "$k" ] && { key="$k"; break; }; done
fi
[ -n "$key" ] && [ -f "$key" ] || { echo "No ssh key: create one with ssh-keygen -t ed25519, or set SSH_KEY=…pub"; exit 1; }

inv=(); [ -n "${INVENTORY:-}" ] && inv=(-i "$INVENTORY")
limit=(); [ -n "${1:-}" ] && limit=(--limit "$1")

# ssh-copy-id reads the password from the terminal, not from the list of servers below
tty_in=/dev/null; (: </dev/tty) 2>/dev/null && tty_in=/dev/tty

# host <tab> port <tab> user <tab> extra ssh args <tab> private key, one line per server
# (the ${a[@]+…} form: macOS bash 3.2 treats an empty array as unset under set -u)
ansible-inventory ${inv[@]+"${inv[@]}"} ${limit[@]+"${limit[@]}"} --list | python3 -c '
import json, sys
inv = json.load(sys.stdin); hv = inv.get("_meta", {}).get("hostvars", {})
def hosts(g):
    out = list(inv.get(g, {}).get("hosts", []))
    for c in inv.get(g, {}).get("children", []): out += hosts(c)
    return out
for h in dict.fromkeys(hosts("malina")):
    v = hv.get(h, {})
    print("\t".join([str(v.get("ansible_host", h)), str(v.get("ansible_port", 22)),
                     str(v.get("provision_user", "root")), str(v.get("ansible_ssh_common_args", "")),
                     str(v.get("ansible_ssh_private_key_file", ""))]))
' | while IFS=$'\t' read -r host port user extra pkey; do
  pkey="${pkey/#\~/$HOME}"; ident=""; [ -n "$pkey" ] && ident="-i $pkey"
  # shellcheck disable=SC2086
  if ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -p "$port" $extra $ident "$user@$host" true 2>/dev/null; then
    echo "$user@$host: key works"
  else
    echo "$user@$host: copying $key (the server asks its password)"
    # shellcheck disable=SC2086
    ssh-copy-id -i "$key" -p "$port" -o StrictHostKeyChecking=accept-new $extra "$user@$host" <"$tty_in"
  fi
done
