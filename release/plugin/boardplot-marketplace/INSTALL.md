# Install into Claude Code: instructions for an agent

A user gave you this package and asked you to install it. Do exactly this.
Every step is non-interactive.

1. **Move to a permanent location first.** The install points at this
   folder for as long as the plugin is installed. A plugin installed from
   Downloads or a temporary folder breaks when that folder is cleaned. If this
   `boardplot-marketplace` folder (or the ZIP it came from) is in a temporary
   location, move or unzip it to a stable one, for example
   `~/boardplot/boardplot-marketplace`. Keep the folder intact.

2. **Register and install** (use the absolute path; both commands print a ✔
   on success):

   ```bash
   claude plugin marketplace add /absolute/path/to/boardplot-marketplace
   claude plugin install boardplot@boardplot --scope user
   ```

   `boardplot` is the name of this marketplace, declared in
   `.claude-plugin/marketplace.json`. The add command prints it.

3. **Verify:**

   ```bash
   claude plugin details boardplot
   ```

   Expected inventory: `Skills (1)` (boardplot-chart) and
   `MCP servers (1) boardplot`.

4. **Tell the user to start a new Claude Code session.** The skill and the
   Boardplot MCP server load there, not in the current session. In the new
   session, "use the boardplot-chart skill" is the entry point. The skill
   carries the Boardplot manual.

If the `claude` command is not available in your shell, give the user the two
commands from step 2 to run in their own terminal. The plugin is installed
when both commands have printed their ✔.

Codex, updates and checks: `plugins/boardplot/SETUP.md`.

Licence: Apache License, Version 2.0. See `plugins/boardplot/LICENSE.txt`.
