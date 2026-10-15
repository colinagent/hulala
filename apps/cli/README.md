# Hulala CLI

The installed `hulala` command starts the local browser workbench and opens
`http://hulala.localhost:3210/` after readiness. Each Workspace uses its own
browser tab. The service binds only to loopback and does not change hosts/DNS.

The browser edition's npm tarballs are generated from verified native packages:

```sh
bun scripts/workbench/package.ts
bun scripts/workbench/npm-package.ts <package-directory>
```

Do not publish this source workspace directly. The generated npm launcher uses
exact platform aliases and requires Node.js 18+. It keeps an integrity-checked
runtime copy under `~/.config/hulala/runtime/distributions`, so background work
survives removal of a temporary npx cache. Standalone packages include Bun and
need no developer runtime on PATH.

```sh
hulala
hulala --no-open
hulala --foreground
hulala service status
hulala service restart
hulala service shutdown
hulala doctor
hulala update
hulala rollback
hulala uninstall
```

Use `--force` explicitly when a requested restart must stop active work.
`hulala service install` enables login startup; `hulala service uninstall`
removes that login job. They are separate from program installation/uninstall.
Installing the program does not start the user's service or enable login startup.

Standalone installation from an extracted package:

```sh
./bin/hulala install --add-to-path
```

On Windows use `.\bin\hulala.exe`. `--root` and `--bin` select program and
command directories; `--from <directory-or-tar.gz>` supports a local package.
Archives and downloads require `--sha256`. Release selection supports explicit
`--version` and opt-in `--channel preview`. Package manager installations report
the commands for their original manager instead of overwriting manager-owned
files. User configuration, native credentials and Workspaces survive uninstall.

`HULALA_HOME`, `HULALA_WORKSPACE_ROOT`, `HULALA_PORT` and
`HULALA_WORKBENCH_PORT` support isolated runs. Use distinct state roots for
independent service instances. See [browser documentation](../../docs/browser-workbench.md)
for package layouts, native validation and release staging.
