# deepseek-consult MCP server

An MCP stdio server exposing one tool, **`consult_deepseek`**, that asks DeepSeek
for an independent second opinion and returns the answer as a first-class tool
result. It pairs with the [`deepseek-consult` skill](../../skills/deepseek-consult/SKILL.md),
which covers _when_ and _how_ to consult (prompt crafting, calibration, the
verify-before-concluding guard).

This is the in-process successor to the old `ds-consult.sh` shell wrapper. It
talks to the [Pi SDK](https://pi.dev/docs/latest/sdk)
(`@earendil-works/pi-coding-agent`) directly instead of spawning `pi --mode json`,
which removes the subprocess-hang failure mode. The wrapper's hard-won behaviours
are preserved: pure-reasoning isolation (no repo writes, no project context
leakage), tiered models with per-tier timeouts, a wall-clock guard, and stateful
multi-turn sessions.

## Requirements

- **Node 18+** (uses `node:sqlite` via the SDK; tested on Node 25).
- **A working `pi` DeepSeek auth.** The server resolves credentials through the
  Pi SDK's `AuthStorage` exactly as the `pi` CLI does — `~/.pi/agent/auth.json`,
  then env vars including `DEEPSEEK_API_KEY`. If you can run `pi` against
  DeepSeek, this server works with no extra configuration.

## Dependencies

`node_modules/` is gitignored (not shipped), so deps are installed differently
depending on how you're using the repo:

- **Local dev** — this server is an npm **workspace member** of the repo root.
  A single `npm install` at the repo root installs every workspace's deps
  (hoisted) plus the shared dev tooling. Node's ESM resolver then finds the SDK
  by walking up to the root `node_modules`. No per-server install needed.

- **Installed as a Claude Code plugin** — handled automatically by the
  `SessionStart` hook in [`hooks/hooks.json`](../../hooks/hooks.json) (script:
  [`hooks/install-deps.sh`](../../hooks/install-deps.sh)). On first run (and
  whenever this server's `package.json` changes) it installs the server's
  **runtime** deps into the persistent `${CLAUDE_PLUGIN_DATA}` and symlinks them
  next to the server. You don't run anything.

  Two design notes, in case you touch the hook: it installs the _server's_
  `package.json` (not the root workspace manifest, which carries dev-only
  tooling), and it uses a **symlinked `node_modules`** rather than `NODE_PATH` —
  because `NODE_PATH` only affects CommonJS `require()`, and this server is ESM,
  where bare-import resolution ignores `NODE_PATH` and walks the directory tree.

## Register

The repo's root [`.mcp.json`](../../.mcp.json) already registers it for plugin
installs using the plugin-root variable:

```jsonc
{
  "mcpServers": {
    "deepseek-consult": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-servers/deepseek-consult/index.ts"],
    },
  },
}
```

For a plain clone (not installed as a plugin), point a project/user `.mcp.json`
at the absolute path instead:

```jsonc
{
  "mcpServers": {
    "deepseek-consult": {
      "command": "node",
      "args": [
        "/absolute/path/to/skills/mcp-servers/deepseek-consult/index.ts",
      ],
    },
  },
}
```

If your `pi` auth isn't picked up automatically, add the key to the server's env:

```jsonc
"deepseek-consult": {
  "command": "node",
  "args": ["…/index.ts"],
  "env": { "DEEPSEEK_API_KEY": "${DEEPSEEK_API_KEY}" }
}
```

## The `consult_deepseek` tool

| Param              | Type              | Default | Purpose                                                                |
| ------------------ | ----------------- | ------- | ---------------------------------------------------------------------- |
| `prompt`           | string (required) | —       | The self-contained question.                                           |
| `pro`              | boolean           | `false` | Escalate to `deepseek-v4-pro` (thinking=medium). Default = fast flash. |
| `thinking`         | `off`…`xhigh`     | tier    | Override the tier's thinking level.                                    |
| `continue_session` | boolean           | `false` | Continue the most recent consult conversation.                         |
| `session_id`       | string            | —       | Resume a specific conversation by its returned id.                     |
| `read_only_repo`   | boolean           | `false` | Let DeepSeek read this project (read/grep/find/ls only, no writes).    |
| `timeout_seconds`  | int               | tier    | Wall-clock guard. Default flash 180s, pro 300s.                        |

The result text ends with a footer carrying `session=<id>`; pass that back via
`session_id` (or `continue_session: true`) for a stateful follow-up turn.

### Isolation

By default a consult runs with `noTools: "all"` from a neutral working directory,
and with a `DefaultResourceLoader` configured `noExtensions` / `noSkills` /
`noContextFiles` plus a fixed reviewer system prompt. DeepSeek sees only the
prompt you send — never the host project's `AGENTS.md` or skills. `read_only_repo:
true` relaxes this to allow read-only repo access from the project directory.

## Smoke test

```bash
node -e 'import("@earendil-works/pi-coding-agent").then(async (M)=>{
  const { createAgentSession, SessionManager, AuthStorage, ModelRegistry } = M;
  const { getModel } = await import("@earendil-works/pi-ai");
  const authStorage = AuthStorage.create();
  const { session } = await createAgentSession({
    model: getModel("deepseek","deepseek-v4-flash"), thinkingLevel:"low", noTools:"all",
    sessionManager: SessionManager.inMemory(), authStorage,
    modelRegistry: ModelRegistry.create(authStorage),
  });
  await session.prompt("Reply with exactly: OK");
  console.log(session.messages.at(-1).content.map(c=>c.text).join(""));
})'
```

Prints `OK` if auth and model resolution are working.
