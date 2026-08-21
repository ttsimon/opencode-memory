# ADR 0003: Route Management Commands Through The Memory Tool

## Status

Accepted

## Context

OpenCode memory management commands will need to invoke deterministic database operations and return their results without asking the model to invent or infer state. OpenCode 1.18.19 exposes command templates and the `command.execute.before` hook, but the verified hook contract limits what the plugin can do at that boundary.

The verified limitation is: `command.execute.before` can only mutate the output `parts`; it cannot short-circuit command execution and cannot directly return database results.

## Decision

Register memory management commands with strict command templates. For known memory commands, use `command.execute.before` only to replace or adjust the mutable `parts` with the same routing instruction. That instruction requires the model to call the plugin's `memory` custom tool exactly once with the fixed action and command arguments, then return the tool output verbatim.

Keep database access inside the custom tool implementation. Do not place database logic or claimed database results in command templates or hook-generated text.

## Alternatives

- Execute database operations directly inside `command.execute.before` and return the result from the hook.
- Put database state or query logic into command prompt text and ask the model to infer the result.
- Expose management only through the generic custom tool without named commands.
- Add an external command service outside the OpenCode plugin lifecycle.

## Consequences

- Command routing respects the actual OpenCode 1.18.19 hook contract.
- Database behavior remains deterministic and testable inside the custom tool.
- Named commands require a model-mediated tool call, so templates and hook mutations must strictly constrain that call and require verbatim output.
- The hook cannot be treated as a direct command handler: it changes `parts` only and cannot bypass the remaining command execution path.
- Changes to the OpenCode hook contract require compatibility testing before this routing design is revised.
