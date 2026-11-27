---
slug: plugin-installed-but-not-loaded
title: Installed the plugin, the Host never loaded it
description: Hulala 0.3.39 reports what the running Host actually loaded, repairs a stale plugin link at boot, and tells you whether a plugin install took effect.
date: 2026-11-27
version: 0.3.39
---

A plugin is loaded when the Host process starts, not when you install it. If the process that answers your terminal booted before the install finished, it keeps using what it imported then. Hulala 0.3.39 makes that visible in the welcome block and in `hulala host status`, and it repairs the one failure that could hide a plugin forever.

## The install finished, the process did not

Plugin installs write a profile on disk. The Host reads that profile once, at boot, and imports from it. Nothing re-reads it afterwards. So the two facts a person cares about, "it is installed" and "it is loaded", are different facts, and until now only the first was observable: `hulala plugin list` reads the manifest on disk.

We hit this while updating a chat bot plugin. The package landed in `node_modules` at 22:06:01. The Host that served the terminal had started at 22:05:20, 41 seconds earlier. Every file on disk said 0.3.24; the process answering was 0.3.23. Restarting "the Host" from a client that found one already answering printed the same status JSON as starting it, so nothing in the output said which one had happened.

What 0.3.39 adds is the missing fact. The Host reads its live Loader on every health request and reports the roster it actually has:

```sh
hulala host status
```

That document now carries a `degraded` list when something declared did not activate, and `hulala host start` says whether it started a Host or found one running:

```
hulala: the Host was already running (pid 96269, started 2026-11-27T14:55:55.596Z); nothing was started.
```

## What the welcome block tells you

Starting a session prints what the Session has: skills, MCP servers. Below the banner and above those two lists, there is now a `[Problems]` section, one line per entry the Host promised and did not activate:

```
[Problems]
  @colinagent/dsh-mcp@0.1.1 (failed)
[Skills]
  release-hulala
```

It stays absent when the composition is complete, and it stays silent on a Host too old to report a roster, so the normal startup looks exactly as before. That placement is deliberate: a list of MCP servers is a promise, and a reader who is about to trust it should see the broken promise first.

For a script there is a gate:

```sh
hulala doctor
# … "problems": [], "warnings": []
# hulala doctor: ok
```

It checks the profile links, the running Host's roster, and every entry that is not active. It exits non-zero on a problem, and treats an old Host that cannot report a roster as a warning rather than a failure.

## The plugin that vanished for eight days

The other half of this release is a repair. Hulala's Host bundles link into the profile with `link:` entries that point at the runtime version that shipped them. An upgrade keeps the current and previous runtime and deletes the rest. That leaves the profile's symlink pointing at a directory that no longer exists.

The boot code already tried to relink them, but it asked the wrong question first: whether the path exists. A dangling symlink makes that answer false, while the entry still occupies the path, so creating the new link failed with `EEXIST`, the failure was swallowed, and the manifest kept the dead `link:`. The Host booted, the bot answered on Telegram, and MCP tooling was gone. Nine boots across eight days printed this line and nothing else:

```
dsh: warning: 1 entry did not activate
```

The repair now compares the symlink's target with the package directory the runtime ships, and replaces it when they differ. Any boot fixes it, including the boot after an upgrade, and the manifest's `link:` is rewritten in the same pass. We tested it both ways: break the link, start the Host, and `hulala doctor` reports nothing.

## Install now says whether it took effect

`hulala plugin --profile tui add <package>` still installs. What changed is the last line. If a Host is running, the command compares what it loaded against what you just installed:

```
hulala: @colinagent/hulala-bot is installed but not loaded in the running Host (pid 96269); that Host started before it.
hulala: restart the Host to load it (`hulala host stop && hulala host start`), or pass --restart next time.
```

The exit code is still 0, because the install succeeded. Restarting is a separate promise, so it has its own flag. `--restart` stops the Host, starts it again, reads the roster back, and fails if the package you named is still not active. We kept those two outcomes apart on purpose: a command that reports failure after a successful install trains people to ignore its exit code.

The advice splits by cause too. If the roster has no row for the package, the process predates the install and a restart helps. If the row is there with state `failed` or `skipped`, the plugin tried and did not start; the message points at the Host log instead of suggesting a restart that already happened.

## What still does not work

The roster is capped at 128 rows out of roughly 200 in a full Host composition, with failures first and our own `@colinagent/*` packages always included, so a client reading it is never asked to render the whole tree. A deploy that installs from a git URL or a tarball cannot be verified this way, because the package name is not in the spec; `link:` paths and registry names are.

Problems reported here are startup problems. A plugin that activates and then dies during a session is still only a log line, apart from the one case we closed in the bot this week: a bot with no channel configured now fails activation instead of logging a line and reporting healthy.

And the client shows the section once, when the session starts. If you install a plugin while a session is open, `hulala doctor` is the fast answer; the next session prints it in the welcome block.

[Install or update Hulala](/download/), or read [the previous release post](/blog/terminal-stops-switching-input-method/) about the input-method fix.
