# `@hulala/tui-panel-types`

**Types only.** The shapes the terminal client kernel and its built-in panels
share: the closed seat set, what a panel returns for a frame, and a `Disposable`
for everything a panel registers.

There is no runtime here — the `exports` map has a `types` entry and nothing
else. Import with `import type` and the line disappears from the built client.

## What a panel is

A panel is a module under `apps/cli/src/tui/plugins/`, assembled into the window
by the kernel. It declares **content, never geometry**:

```ts
import type { SeatId, PanelView } from '@hulala/tui-panel-types'

// The seats a panel may claim. A second claimant of an exclusive seat is
// refused by name, because a silent replacement looks like a panel that never
// loaded.
const seat: SeatId = 'dock.status'

// Rows, at the width the frame decided. No styling API to learn.
const view: PanelView = {
  render: width => [`${width} columns`],
}
```

`main`, `dock.pending`, `dock.cwd`, `dock.input`, `dock.status`, `rail` and
`pane` are the whole set. Widths, minimums and the narrow-terminal rules stay the
frame's.

## What it is not

This is **not an extension point**. The client's panels are first-party modules
compiled into the window; nothing loads a panel from the user's state root. A
plugin door used to exist here and was removed: there is one plugin system, and
it is DSH's, installed into the Host profile with `hulala plugin --profile …
add <package>`.

## Where the shapes are used

| Type | Used by |
|---|---|
| `SeatId`, `PanelView`, `Disposable` | the frame and every panel that draws rows |
| `PanelManifest` | the client's panel table |
| `PanelApi` | the facade a panel receives from the kernel |

The kernel itself is `apps/cli/src/tui/kernel.ts`; it owns the Cordis `Context`
and its disposal, and nothing above it is fixed.
