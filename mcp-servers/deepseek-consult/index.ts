#!/usr/bin/env node
/**
 * @copyright Sister Software
 * @license AGPL-3.0
 * @author Teffen Ellis, et al.
 */

import os from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  AgentSession,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

// Protect the JSON-RPC channel from any stray stdout writes.
console.log = (...args) => console.error(...args);

// Literal type (not the wide `KnownProvider` union) so getModel's second
// argument narrows to deepseek's model ids instead of collapsing to `never`.
const PROVIDER = "deepseek" as const;

export type DeepSeekTier = "flash" | "pro";
export type DeepSeekThinking =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface DeepSeekOptions {
  tier: DeepSeekTier;
  thinking?: DeepSeekThinking;
  readOnlyRepo?: boolean;
  continueSession?: boolean;
  sessionId?: string;
  timeoutSeconds?: number;
}

export type ModelID = "deepseek-v4-flash" | "deepseek-v4-pro";

export interface DeepSeekTierEntry {
  id: ModelID;
  thinking: DeepSeekThinking;
  timeout: number;
}

const TIERS: Record<DeepSeekTier, DeepSeekTierEntry> = {
  flash: { id: "deepseek-v4-flash", thinking: "low", timeout: 180 },
  pro: { id: "deepseek-v4-pro", thinking: "medium", timeout: 300 },
};

const REVIEWER_SYSTEM_PROMPT = [
  "You are an independent senior engineer brought in for a second opinion.",
  "You cannot see the caller's repository or run tools — reason only from what",
  "the prompt gives you. Be direct and specific. Lead with the answer, then the",
  "reasoning. Name the decisive trade-off or failure mode rather than surveying",
  "every option. If the prompt lacks the context to answer well, say exactly",
  "what you'd need. Match the requested verbosity: terse asks get a punch list,",
  '"walk me through" asks get a trace. Distinguish what you are confident about',
  "from what is a hypothesis to be tested.",
].join(" ");

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const agentDir = getAgentDir();
const projectCwd = process.cwd();
// Isolated consults run from a neutral cwd so no project-local AGENTS.md or
// skills are discovered. Repo-reading consults run from the actual project.
const isolatedCwd = os.tmpdir();

// Live sessions kept for the lifetime of this server, keyed by session id, so
// continuation turns reuse the same in-memory context.
const sessions = new Map<string, any>();
let lastSessionId: string | null = null;

function lastAssistantText(messages: AgentMessage[]) {
  // Iterate backwards to find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;

    if (m.role === "assistant") {
      return (m.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
    }
  }

  return "";
}

async function makeIsolatedLoader(cwd: string): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
  });

  await loader.reload();

  return loader;
}

export interface SessionInit {
  tier: "flash" | "pro";
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readOnlyRepo?: boolean;
}

async function newSession({
  tier,
  thinking,
  readOnlyRepo,
}: SessionInit): Promise<AgentSession> {
  const t = TIERS[tier] ?? TIERS.flash;
  const cwd = readOnlyRepo ? projectCwd : isolatedCwd;
  // Derive the options type from createAgentSession itself — the SDK does not
  // re-export CreateAgentSessionOptions by name, and this keeps the conditional
  // `tools`/`noTools` assignments below type-checked against the real contract.
  const opts: NonNullable<Parameters<typeof createAgentSession>[0]> = {
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader: await makeIsolatedLoader(cwd),
    model: getModel(PROVIDER, t.id),
    thinkingLevel: thinking ?? t.thinking,
    sessionManager: SessionManager.inMemory(),
  };
  // Default consult: pure reasoning, no tools. Opt-in read-only repo access
  // mirrors the wrapper's `--tools-ro` profile.
  if (readOnlyRepo) {
    opts.tools = ["read", "grep", "find", "ls"];
  } else {
    opts.noTools = "all";
  }

  const { session } = await createAgentSession(opts);

  return session;
}

function withTimeout(
  promise: Promise<any>,
  seconds: number,
  onTimeout?: () => void,
) {
  let timer: NodeJS.Timeout;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try {
          onTimeout?.();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `DeepSeek consult timed out after ${seconds}s. Re-scope the question smaller, ` +
              "drop to flash (omit pro), lower thinking, or pass a larger timeout_seconds.",
          ),
        );
      }, seconds * 1000);
    }),
  ]).finally(() => clearTimeout(timer));
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const server = new McpServer({ name: "deepseek-consult", version: "0.1.0" });

const description = [
  "Ask DeepSeek for an independent second opinion: architectural review, design",
  "exploration, code feedback, or a fresh-eyes sanity check. DeepSeek reasons only",
  "from the prompt you send — it cannot see your repo (unless read_only_repo=true)",
  "— so make the first turn self-contained: what the system is, what's built, the",
  "specific question. Paste signatures, types, and short snippets rather than",
  "dumping files. End with a concrete question.",
  "",
  "Returns DeepSeek's answer plus a meta footer with the session id. To go",
  "multi-turn, call again with that session_id (or continue_session=true) — the",
  "prior context is retained, so build on it rather than re-pasting.",
  "",
  "Calibration: trust DeepSeek's structural and procedural advice (reframes,",
  "alternatives, naming the trade-off); treat quantitative predictions (thresholds,",
  "step counts, percentages) as hypotheses to falsify with a cheap probe, not gates.",
].join("\n");

const inputSchema = {
  prompt: z
    .string()
    .describe(
      "The full, self-contained question for DeepSeek. Include system context, " +
        "relevant code snippets/types, and a concrete closing question.",
    ),
  pro: z
    .boolean()
    .optional()
    .describe(
      "Escalate to deepseek-v4-pro (thinking=medium) for deep architectural turns. " +
        "Slower; keep the prompt scoped. Default false = deepseek-v4-flash (fast).",
    ),
  thinking: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh"])
    .optional()
    .describe("Override the tier's default thinking level."),
  continue_session: z
    .boolean()
    .optional()
    .describe(
      "Continue the most recent consult conversation (like the old `-c`).",
    ),
  session_id: z
    .string()
    .optional()
    .describe(
      "Resume a specific conversation by the id returned in a prior result.",
    ),
  read_only_repo: z
    .boolean()
    .optional()
    .describe(
      "Let DeepSeek read the current project (read/grep/find/ls only, no writes). " +
        "Slower; opt-in. Default false = pure reasoning, fully isolated.",
    ),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Override the wall-clock timeout (default: flash 180s, pro 300s).",
    ),
};

server.registerTool(
  "consult_deepseek",
  {
    title: "Consult DeepSeek",
    description,
    inputSchema,
  },

  async (a): Promise<CallToolResult> => {
    try {
      const tier = a.pro ? "pro" : "flash";
      const t = TIERS[tier];

      let id = a.session_id ?? (a.continue_session ? lastSessionId : null);
      let session: AgentSession = id ? sessions.get(id)?.session : null;
      const resumed = Boolean(session);

      if (!session) {
        if (id && a.session_id) {
          // Asked for a specific id we no longer hold (e.g. server restarted).
          return errorResult(
            `consult_deepseek: session "${a.session_id}" is not available (it may have expired). ` +
              "Start a new consult by omitting session_id.",
          );
        }
        session = await newSession({
          tier,
          thinking: a.thinking,
          readOnlyRepo: Boolean(a.read_only_repo),
        });
        id = session.sessionId;
        sessions.set(id, { session });
      }
      lastSessionId = id;

      const timeout = a.timeout_seconds ?? t.timeout;
      const startedAt = Date.now();

      await withTimeout(session.prompt(a.prompt), timeout, () => {
        try {
          session.abort();
        } catch {
          /* ignore */
        }
      });
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

      const text = lastAssistantText(session.messages);
      if (!text.trim()) {
        return errorResult(
          "consult_deepseek: DeepSeek returned an empty response. Retry with a shorter, " +
            "more concrete prompt.",
        );
      }

      const footer =
        `\n\n---\n` +
        `model=${t.id} thinking=${a.thinking ?? t.thinking} elapsed=${elapsed}s ` +
        `session=${id}${resumed ? " (continued)" : ""}\n` +
        `To build on this turn, call consult_deepseek again with session_id="${id}" ` +
        `(or continue_session=true).`;

      return { content: [{ type: "text", text: text + footer }] };
    } catch (err: unknown) {
      return errorResult(
        `consult_deepseek error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[deepseek-consult] MCP server ready on stdio.");
