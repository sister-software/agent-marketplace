---
name: deepseek-consult
description: Consult DeepSeek for architectural review, code feedback, design exploration, or second opinions. Use when the operator requests a conversation with DeepSeek, or when an independent perspective would strengthen a design decision. Includes per-category calibration (trust structure, test numbers) and an extended verify-before-concluding guard for quantitative predictions.
---

# DeepSeek Consult

Get an independent second opinion from DeepSeek through the **`consult_deepseek`
MCP tool**. The tool runs DeepSeek as a pure-reasoning reviewer (no repo writes,
isolated from this project's context) and returns the answer as a first-class
tool result.

> The tool is provided by the `deepseek-consult` MCP server in this repo
> (`mcp-servers/deepseek-consult/`). If `consult_deepseek` isn't available,
> the server isn't registered — see that directory's README to wire it up.

## Invocation

Call the `consult_deepseek` tool. Parameters:

| Param              | Default | Purpose                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------- |
| `prompt`           | —       | The self-contained question (required).                                               |
| `pro`              | `false` | Escalate to `deepseek-v4-pro` (thinking=medium) for deep turns. Default = fast flash. |
| `thinking`         | tier    | Override thinking level (`off`…`xhigh`).                                              |
| `continue_session` | `false` | Continue the most recent consult conversation.                                        |
| `session_id`       | —       | Resume a specific conversation by the id from a prior result.                         |
| `read_only_repo`   | `false` | Let DeepSeek read this project (read/grep/find/ls only). Opt-in; slower.              |
| `timeout_seconds`  | tier    | Override the wall-clock guard (flash 180s, pro 300s).                                 |

Each result ends with a footer carrying `session=<id>`. To go multi-turn, call
again with that `session_id` (or `continue_session: true`) — DeepSeek retains
the prior context, so build on it rather than re-pasting.

```
Turn 1  consult_deepseek({ prompt: "<system> <problem> <N questions>" })
Turn 2  consult_deepseek({ prompt: "Good on Q3. Drill into Q1: …", continue_session: true })
Turn 3  consult_deepseek({ prompt: "Reason through the failure modes of X", pro: true, continue_session: true })
```

## Model / thinking policy

- **Default = flash (`thinking: low`)**, ~2–30s. Use it for most turns, iteration,
  and quick checks.
- **`pro: true` = `deepseek-v4-pro` (`thinking: medium`)** for deep architectural
  turns. Slower; always timeout-guarded.
- **Keep pro prompts scoped.** Pro + a sprawling "be thorough, answer all 5
  questions" prompt is what causes long, silent reasoning runs. Ask one hard
  thing at a time, or raise `timeout_seconds` deliberately. On timeout, re-scope
  or drop to flash — don't blindly retry the same prompt.

## When to use

- Operator says "get DeepSeek's opinion", "check with DeepSeek", "ask DeepSeek".
- Design decisions that benefit from an independent architectural perspective.
- Code review where fresh eyes catch assumptions.
- Exploring trade-offs before committing to an implementation direction.
- Multi-turn deep dives (6–10 turns) narrowing from problem to punch list.

## Prompt crafting

1. **Context is king.** DeepSeek sees only what you send. The _first_ turn must
   be self-contained: what the system is, what's built, the specific question.
2. **Reference code inline.** By default DeepSeek can't read your files. Paste
   signatures, types, or critical 5–10 line snippets; summarize and quote rather
   than dumping whole files. (For genuine repo exploration, `read_only_repo: true`.)
3. **End with a concrete question.** "Which of these two, and what are the failure
   modes?" beats "what do you think?"
4. **Directive controls verbosity.** "Be terse" → punch list. "Be thorough" →
   essay (scope it, especially with `pro`). "Walk me through X" → trace.
5. **Sessions are stateful.** With `continue_session`/`session_id`, each turn
   builds on the prior one — don't re-paste context, build on it.

Operator preferences: prefers multi-turn (6–10) that progressively deepen; start
broad, narrow to specifics, end with an execution plan; DeepSeek's code = design
sketches, not copy-paste; may inject mid-conversation — fold it into the next
turn; "N turns" is a budget — honor it.

## Calibration — structure vs numbers

DeepSeek's quality is **not uniform across answer types**. Calibrate against the
asymmetry:

| Contribution type                                                                                           | Track record                                               | How to weight                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Structural** — reframes, architectural alternatives, naming the problem, eliminating an option as unsound | strong; often names the decisive reframe you'd have missed | trust, but cross-check against your domain ethos; it survives downstream numeric misses |
| **Procedural** — pre-registered gates, evidence checklists, "verify before concluding"                      | strong                                                     | apply directly                                                                          |
| **Quantitative** — predicted accuracy / metric / step-count thresholds                                      | weak                                                       | treat as a hypothesis to falsify, not a gate to lower; run the cheap probe              |

**Operational rule: trust the structure, test the numbers.** Fold in structural
reframes. When DeepSeek hands back a quantitative prediction with a threshold,
write it down as a _pre-registered prediction_ and verify it with a probe. Don't
build a follow-up plan that depends on the quantitative prediction holding.

## Verify-before-concluding guard

Add a penultimate turn to any session that will drive a real decision:

> "Before concluding — did we verify against functional tests / ground truth? Do
> the metrics and the functional evidence agree? If not, which do we trust?"

This catches "do not ship" verdicts built on an invalid comparison.

**Extended for quantitative predictions:** when DeepSeek recommends a path based
on a quantitative prediction (a threshold, a step count, a percentage), the
penultimate turn also asks for the probe that would falsify it cheaply — **and
the probe is run before the recommended path**:

> "Before we proceed: what's the 30-minute experiment that would falsify the
> 'X clears threshold Y at step Z' prediction? If it holds, we continue; if it
> falsifies, we re-scope."

This catches (a) predictions too vague to falsify (usually too vague to act on),
and (b) predictions DeepSeek would itself de-weight once asked to design a
falsifier.

## Evidence checklist (for model / quality consultations)

Before any prompt about model quality, training results, or recipe changes,
include ALL of:

1. **Functional output** — concrete examples of the system's behavior, not just
   aggregate metrics. Aggregate numbers without functional evidence are
   insufficient to conclude.
2. **Version identifiers** — state tokenizer/model/data versions when comparing.
   Different tokenizers or preprocessing invalidate metric comparisons.
3. **Raw output, not just summaries** — show the full output (including the parts
   a summary view drops) so coverage gaps are visible.
4. **A what-changed matrix** — for multi-variable comparisons, list every
   parameter that changed between the runs.

(These are calibrated from a sequence-labeling project; adapt the specifics to
your domain, but keep the four shapes.)

## Scoreboard maintenance

Every consult on a quantitative question gets a one-line entry in your session
notes, scored after the experiment:

```
Session: <id>
- structural:   <count predicted-and-held / count predicted>
- quantitative: <count predicted-and-held / count predicted>
- counter-evidence: <one line per falsified prediction>
```

The scoreboard is the corrective to "DeepSeek said X, so we did X", and the
calibration record for the next session — if it missed three quantitative
predictions in a row, the next consult opens with that fact on the table.

Example entry (a model-consolidation arc, retrospective):

- structural: 3/3 — frozen-encoder probe design, label-partition for the affix head, curriculum-erosion reframe.
- quantitative: 0/3 — "5× clears ≥72" (held at 64.9), "75 is not a transient" (decayed 75→52.9), "try reweighting first" (decayed anyway under tag-weight 4.0).
- counter-evidence: the capacity-tell was framed for a steady-state miss; the transient-then-decay shape wasn't anticipated.

## Cross-session continuity

The MCP server holds session context **in memory for the life of the server**
(i.e. across turns within one working session). It does **not** persist across
restarts — and DeepSeek itself has no memory across conversations. After a
productive session, distill the conclusions into a tracked notes file beside this
skill so the next session can paste them into turn 1. Include the calibration
scoreboard line for any quantitative consult.

## Failure modes

- **Timeout.** The model ran past the wall-clock guard. Re-scope smaller, drop to
  flash, lower `thinking`, or pass a larger `timeout_seconds` if a long pro turn
  is genuinely warranted. Don't blindly retry the same prompt.
- **Empty response.** The tool reports it. Retry with a shorter, more concrete
  prompt; if it persists, the DeepSeek auth/key may be bad (see the server README).
- **Session not available.** A `session_id` from before a server restart is gone;
  start a new consult by omitting it.
- **Generic answers.** The prompt lacked context. Add file paths, types, and the
  specific constraint that makes the question non-trivial.
