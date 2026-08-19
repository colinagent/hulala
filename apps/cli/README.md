# LoopWithAI CLI

Launch the private LoopWithAI workbench with one command:

```bash
npx loopwithai
```

Node.js 24 or newer is required. npm and npx are included with Node.js; macOS
and Windows do not provide npx by themselves.

The command starts a background Launcher bound only to `127.0.0.1`, waits for
the managed Workbench, and opens `http://loopwithai.localhost:3210/`. The
`.localhost` name resolves locally by platform convention: LoopWithAI never
changes DNS or the system hosts file and never requests administrator access.

The Local menu shows Launcher and Workbench state, PID, version and uptime. It
can stop or restart the Workbench while keeping a recovery page available.
Cloud opens `https://loopwith.ai/` in a new tab.

## Login autostart

The page can install a current-user login watchdog after an explicit click. It
uses a LaunchAgent on macOS and Task Scheduler on Windows. The same operations
are available in a terminal:

```bash
loopwithai service status
loopwithai service start
loopwithai service stop
loopwithai service restart
loopwithai service install
loopwithai service uninstall
loopwithai service update
```

Updates are never installed silently. A confirmed update is downloaded to a
versioned staging directory, checked against npm integrity metadata, started on
isolated ports, and activated only after the health check passes. The previous
version remains available for rollback.

Source and documentation: <https://github.com/colinagent/hulala>
