# Hermes Agent MCP client compatibility

Checked 2026-10-10 against https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp (via web search summary; re-read the page before writing the agent guide).

- MCP servers are configured under `mcp_servers` in `~/.hermes/config.yaml`.
- Each entry is either stdio (`command`, `args`, `env`) or HTTP (`url`, `headers`), not both.
- HTTP entries can carry a Bearer token in `headers`.
- HTTP transport needs the `mcp` package with `mcp.client.streamable_http`; without it that server fails to load with an ImportError while others continue.
- Other keys: `enabled`, `timeout` (120), `connect_timeout` (60), `ssl_verify`, tool include/exclude filters.
- Tools are registered as `mcp_{server_name}_{tool_name}`, hyphens and dots replaced by underscores.

Expected config for this project:

```yaml
mcp_servers:
  expensegauge:
    url: http://<host>:8080/mcp
    headers:
      Authorization: Bearer eg_xxx
```

Implication: Streamable HTTP at `/mcp` with Bearer auth works with the user's agent. Tool names should be short and underscore-only.
