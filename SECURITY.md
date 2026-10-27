# Security

Do not open a public issue for a security problem.

Report it privately through GitHub private vulnerability reporting: go to
<https://github.com/boardplot/boardplot/security/advisories/new>, or open the
repository's **Security** tab and choose **Report a vulnerability**. Include
the Boardplot version, the steps to reproduce and what an attacker can do.

## Rendering specs you do not trust

Boardplot lays out a chart in one synchronous call. A very large spec, such as
tens of thousands of categories, can take seconds and several hundred MB. An
app or server that renders specs from users or agents should render in a
worker or child process with a time limit, and cap the spec size.

The MCP server reads `rowsFile` and writes `outDir` only inside its allowed
folders; see the manual.

## Supported versions

Boardplot is in 0.x. Only the latest release gets security fixes.

## What happens next

You get an answer when the report has been read. A fix ships in a patch
release, and the advisory is published after the release.
