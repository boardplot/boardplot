# Telemetry and feedback

Boardplot can send two things: usage counts, and a problem report that you approve. Both are off until you act. The React components, the rendered SVG and the PNG never send anything.

**This release sends nothing.** Its collector address is empty, so no usage event and no report leaves your machine through Boardplot, and no notice appears. `boardplot telemetry status` shows `reason: "no-endpoint"`. The rest of this page describes what a release with a collector does.

## Usage counts

They tell the maintainers how many installs use Boardplot, which chart types and options people use, and which warnings and errors they meet most often. That decides what to fix and document first. The counts cover only installs whose users turned them on, so they are not a count of all users.

### Off until you turn it on

Nothing is sent until you run:

```
boardplot telemetry on
```

The CLI and the MCP server read the same choice. With the Claude Code or Codex plugin, which puts no `boardplot` command on your PATH, the MCP server names the exact command of your install.

On the first interactive CLI run, Boardplot prints one line on stderr about this switch. The MCP server passes the same line to the agent once, and asks it to tell you. Neither asks again, and neither turns anything on.

### What one event holds

One event per CLI command or MCP tool call. Every field is listed here; the code refuses to send an event with any other field, and the collector refuses it too.

| Field | Example | What it is |
|---|---|---|
| `v` | `1` | Event format version. |
| `install` | `3f2b8c1e-…` | A random ID, replaced on the first event of each calendar month, so no record links one install across months. `boardplot telemetry off` deletes it. |
| `version` | `0.51.0` | Boardplot version. |
| `surface` | `cli` | `cli` or `mcp`. |
| `command` | `render` | `list`, `describe`, `fixtures`, `render`, `measure` or `fonts`. |
| `types` | `["bar"]` | Chart type names. A name Boardplot does not know is sent as `other`. |
| `optionKeys` | `["sort", "valueAxis"]` | Top-level option names that the chart type declares. Values are never sent; an option name the type does not declare is dropped. |
| `codes` | `["label-dropped"]` | Warning and error codes. Messages are never sent. |
| `ok` | `true` | Whether the call succeeded. |
| `format` | `svg` | `svg` or `png` for a render, `none` for other commands. |
| `host` | `claude-code` | The agent or editor that ran Boardplot, as one of `claude-code`, `claude-app`, `codex`, `cursor`, `vscode`, `gemini`, `other` or `none`. Its own name and version are not sent. |
| `os` | `darwin` | `darwin`, `linux`, `win32` or `other`. |
| `node` | `22` | Node.js major version. |

Never sent: chart data, values, labels, titles, notes, file names or paths, theme colours, messages, the host name, the user name, environment variables, or a time finer than the day the collector receives the event.

The install ID makes the events of one month linkable to each other. A rare combination of fields can single out one install. Treat the data as pseudonymous, not anonymous.

### Turn it off

Any of these stops all usage counts. Each one wins over `boardplot telemetry on`.

- `boardplot telemetry off`: stores your no, asks the collector to delete the raw events of this month's install ID, and deletes the ID and any queued events on your machine.
- `BOARDPLOT_TELEMETRY=0` in the environment.
- `DO_NOT_TRACK=1` in the environment.
- A CI environment (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI` and other CI variables): nothing is sent in CI.

A running MCP server reads the choice again before each event, so `off` applies at once.

### See what was sent

```
boardplot telemetry status
```

It prints `telemetry` (`on` or `off`), the `reason`, your stored `choice`, the `file` that holds it, the collector `endpoint`, this month's `install` ID, `lastEvent` (the exact last payload queued) and `lastDelivery` (the day, the number of events and the HTTP status the collector returned; 204 means stored).

The choice lives in `telemetry.json` in `$XDG_CONFIG_HOME/boardplot/`, else `%APPDATA%\boardplot\` on Windows, else `~/.config/boardplot/`. Events wait in `telemetry-queue.jsonl` beside it; the CLI starts one background sender at most once a minute, and the MCP server sends every 30 seconds. Deleting the folder resets Boardplot to "not chosen".

## Problem reports

When Boardplot does something wrong, `boardplot feedback` (or the MCP tool `boardplot_feedback`) builds a short report:

```
boardplot feedback --category bug --type bar --codes label-dropped --summary "Bar value labels vanish at narrow widths."
```

The report holds the Boardplot version, `cli` or `mcp`, the OS family, the Node.js major version, the category (`bug`, `friction` or `docs`), the chart type, option names, warning and error codes, and a one-line summary of at most 280 characters. It holds no install ID, so a report is not linked to usage counts.

Both return the report and `issueUrl`, a link that opens a new GitHub issue with the report filled in. Opening the link sends its text to GitHub in the address; the issue becomes public when you submit it. Read it first.

- The MCP tool only drafts. An agent's tool call does not prove that you approved the text, so the tool sends nothing. When an agent drafts a report, the draft passes through the agent and its model provider like the rest of the conversation.
- The CLI sends the report to the maintainers only with `--send`, once a release has a collector. Run or approve that command only after you read the report. Without a collector, `--send` returns `issueUrl` instead.

Write the summary without client names, numbers, labels or file paths. To show the problem, attach a spec with invented data to the GitHub issue.

## Where it goes and how long it is kept

A release with a collector sends to one HTTPS endpoint that the Boardplot maintainers run on Cloudflare Workers with a D1 database in the EU jurisdiction. The collector stores the fields above and the day an event arrived. It does not store your IP address, request headers or the user agent, and its request logs are off. Cloudflare, as the network provider, sees the IP address in transit and processes it under its data processing agreement.

- Raw usage events (with the install ID): deleted after 35 days.
- Daily and monthly counts (no install ID): kept for trends.
- Problem reports: deleted after 180 days.
- D1 keeps a recovery history (Time Travel) of 7 days on the free plan and 30 days on paid plans, so deleted rows can stay restorable that long.

The variable `BOARDPLOT_TELEMETRY_ENDPOINT` points a release that has a collector at your own collector instead. It cannot switch on a release without one.
