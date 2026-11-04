# `@hulala/plugin-sdk` — the contract a terminal-client plugin is written against

**Types only.** This package has no runtime. A plugin imports nothing; everything
it needs arrives as the argument to `activate`. Import from here with `import type`
so the line disappears from the built file:

```js
/** @param {import('@hulala/plugin-sdk').PluginApi} tui */
export function activate(tui) {
  tui.command('blame', 'Show git blame for the open file', async () => {
    tui.notice('blame is not implemented yet')
  })
  return tui.seat('dock.status', { id: 'blame' }, {
    render: () => [],
  })
}
```

That rule is what lets a plugin be one plain `.mjs` file in a directory: no
dependency on this repository, no build step, no `node_modules`. The client loads
it with a dynamic `import()` in the same process it already runs in.

## Where a plugin lives

```
~/.hulala/config/plugins/<id>/
  package.json     the manifest, below
  index.js         the entry module
```

The directory name is the plugin's identity. It sits under `config/` beside the
Neovim plugins Hulala already reads.

## The manifest

```json
{
  "name": "hulala-plugin-blame",
  "version": "0.1.0",
  "type": "module",
  "hulala": {
    "tui": {
      "apiVersion": 1,
      "entry": "./index.js"
    }
  }
}
```

`entry` must be `./`-relative and stay inside the package. `apiVersion` is
compared with the client's; a newer plugin is refused with both numbers in the
message rather than failing somewhere inside `activate`.

`hulala plugin check <id>` validates all of this, then activates the plugin
against a recording stand-in and renders every seat it registered at 20, 80 and
200 columns. It reports exactly what it proved, and says what it did not.

## What `activate` receives

The whole surface is one object. `PluginApi` in `src/index.ts` is the
authority; the shape in one paragraph:

- `seat(seat, { id }, { render })` — put rows into the frame. The seats are a
  closed set: `main`, `dock.pending`, `dock.cwd`, `dock.input`, `dock.status`,
  `rail`, `pane`. **A seat declares content, never geometry** — widths, minimums
  and the narrow-terminal rules stay the frame's.
- `command(name, description, run)` — add a `/name`. It appears to `/help` and
  receives the trimmed argument.
- `notice(text)` / `error(text)` — write one line into the conversation.
- `state()` — read-only facts: the open Session, its directory, the model,
  whether a turn runs, token metrics, the Session list.
- `refresh()`, `log(level, message)`, `apiVersion`, `dataDir`.

Everything returns a `Disposable`, and anything a plugin registers is removed
when the window closes, in reverse order, without the plugin doing anything.

## What it is not

There is no sandbox. A plugin is ordinary ESM running with the client's own
privileges — it can open files, spawn processes and read whatever the user can.
The contract is narrower than that on purpose, but narrower is not isolated.
Install a plugin only from a source you would run directly.

The input pipeline is not pluggable either: a plugin registers no raw keys,
because the client's interrupt and focus keys have to keep working no matter what
is installed.
