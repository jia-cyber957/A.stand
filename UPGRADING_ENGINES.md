# Upgrading Engine Adapters

Agent Relay isolates every external AI harness into a single dedicated adapter file under `src/engines/`:

| Engine | Adapter File | Protocol |
| :--- | :--- | :--- |
| OpenAI Codex CLI | `src/engines/codex.mjs` | Native `codex app-server --stdio` JSON-RPC |
| DeepSeek Harness / ACP | `src/engines/acp.mjs` | Standard Agent Client Protocol (`dsh --profile acp`) |
| Anthropic Claude Code | `src/engines/claude-code.mjs` | `claude -p --output-format stream-json --resume` |
| Google Antigravity CLI | `src/engines/antigravity.mjs` | `agy -p` headless CLI |

## When an Upstream CLI Changes Its Interface

1. Run the built-in contract check:
   ```bash
   npm run check:contracts
   ```
2. For Codex CLI, you can export the exact latest schema directly from your local binary:
   ```bash
   codex app-server generate-json-schema --out ./tmp-schema
   ```
3. Update only the affected file under `src/engines/` — UI, session persistence, telemetry, and all other engines remain completely untouched.
4. Rebuild, re-install (user data in `$PLUGIN_DATA` is preserved), and verify:
   ```bash
   npm run install:antigravity
   npm run test:e2e
   ```
