# Sister Software Skills

A collection of [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) used by Sister Software.

## Installing

These skills work with any agent that supports the Agent Skills standard, including Claude Code, OpenCode, OpenAI Codex, and Pi.

### Claude Code

Install using the [plugin marketplace](https://code.claude.com/docs/en/discover-plugins#add-from-github):

```
/plugin marketplace add sister-software/skills
/plugin install sister-software@sister
```

### Pi

Install from the Pi Marketplace or add manually via **Settings > Rules > Add Rule > Remote Rule (Github)** with `sister-software/skills`.

### npx skills

Install using the [`npx skills`](https://skills.sh) CLI:

```
npx skills add https://github.com/sister-software/skills
```

### Clone / Copy

Clone this repo and copy the skill folders into the appropriate directory for your agent:

| Agent        | Skill Directory              | Docs                                                                               |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| Claude Code  | `~/.claude/skills/`          | [docs](https://code.claude.com/docs/en/skills)                                     |
| Cursor       | `~/.cursor/skills/`          | [docs](https://cursor.com/docs/context/skills)                                     |
| OpenCode     | `~/.config/opencode/skills/` | [docs](https://opencode.ai/docs/skills/)                                           |
| OpenAI Codex | `~/.codex/skills/`           | [docs](https://developers.openai.com/codex/skills/)                                |
| Pi           | `~/.pi/agent/skills/`        | [docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#skills) |

## Commands

Commands are user-invocable slash commands that you explicitly call.

| Command | Description |
| ------- | ----------- |

## Skills

Skills are contextual and auto-loaded based on your conversation. When a request matches a skill's triggers, the agent loads and applies the relevant skill to provide accurate, up-to-date guidance.

| Skill                                                  | Description                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`de-slop`](skills/de-slop/SKILL.md)                   | Detect and remove "LLM smells" (AI-slop tells) from any text or document.                                  |
| [`deepseek-consult`](skills/deepseek-consult/SKILL.md) | Consult DeepSeek for architectural review, code feedback, or a second opinion — with built-in calibration. |

## MCP servers

Some skills are backed by an MCP server in [`mcp-servers/`](mcp-servers/). These ship Node code and need their dependencies installed before use.

| Server                                                       | Backs skill        | Tool               |
| ------------------------------------------------------------ | ------------------ | ------------------ |
| [`deepseek-consult`](mcp-servers/deepseek-consult/README.md) | `deepseek-consult` | `consult_deepseek` |

The repo's [`.mcp.json`](.mcp.json) registers them for plugin installs via `${CLAUDE_PLUGIN_ROOT}`. Dependencies (`node_modules`) are gitignored and resolved automatically:

- **Plugin install** — the `SessionStart` hook in [`hooks/hooks.json`](hooks/hooks.json) installs each server's runtime deps into the persistent `${CLAUDE_PLUGIN_DATA}` and symlinks them into place. Nothing to run.
- **Local dev** — the servers are npm workspaces; one `npm install` at the repo root installs everything.

See each server's README for auth and registration details.
