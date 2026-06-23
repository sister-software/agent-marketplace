#!/usr/bin/env bash
#
# SessionStart hook — make MCP-server dependencies available at runtime when
# this repo is installed as a Claude Code plugin.
#
# WHY THIS EXISTS
#   node_modules is gitignored (not shipped with the plugin), and
#   ${CLAUDE_PLUGIN_ROOT} is replaced wholesale on every plugin update. So we
#   install each server's runtime deps into the *persistent* ${CLAUDE_PLUGIN_DATA}
#   once — and again whenever that server's package.json changes — then symlink
#   them next to the server so Node finds them.
#
# WHY A SYMLINK, NOT NODE_PATH
#   NODE_PATH only affects CommonJS require(). These servers are ESM
#   ("type":"module"), and ESM bare-specifier resolution ignores NODE_PATH — it
#   walks up parent directories looking for a node_modules. The symlink *is* that
#   node_modules, pointing at the persisted install.
#
# WHY NOT THE ROOT package.json
#   The root manifest is the dev/workspace manifest (eslint, prettier, tsc, …).
#   At runtime a server needs only its own deps, so we install per-server.
#
# This runs every SessionStart. The npm install is gated on a manifest diff, so
# it's a no-op unless deps changed (or first run). The symlink is recreated
# unconditionally because ${CLAUDE_PLUGIN_ROOT} is a fresh path after an update.
set -uo pipefail

# Servers whose deps must be installed for the plugin to work. Add new MCP
# servers (each a workspace member with its own package.json) here.
SERVERS=(
  "mcp-servers/deepseek-consult"
)

data="${CLAUDE_PLUGIN_DATA:?CLAUDE_PLUGIN_DATA not set — this hook only runs as an installed plugin}"
root="${CLAUDE_PLUGIN_ROOT:?CLAUDE_PLUGIN_ROOT not set}"

for rel in "${SERVERS[@]}"; do
  srv="$root/$rel"
  # One data subdir per server so multiple servers don't collide.
  store="$data/$rel"
  mkdir -p "$store"

  # Install into the persistent store on first run or when the manifest changes.
  if ! diff -q "$srv/package.json" "$store/package.json" >/dev/null 2>&1; then
    if cp "$srv/package.json" "$store/package.json" \
        && (cd "$store" && npm install --no-audit --no-fund --omit=dev); then
      :
    else
      # Install failed — drop the copied manifest so the next session retries.
      rm -f "$store/package.json"
    fi
  fi

  # Bridge ESM resolution: link the persisted node_modules next to the server.
  # Skip if a real node_modules already exists there (a local dev checkout that
  # ran `npm install` itself) so we never clobber it.
  if [ -d "$store/node_modules" ] \
      && { [ ! -e "$srv/node_modules" ] || [ -L "$srv/node_modules" ]; }; then
    ln -sfn "$store/node_modules" "$srv/node_modules"
  fi
done
