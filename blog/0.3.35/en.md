---
slug: panel-keys-without-a-command-key
title: Panel keys that survive ssh
description: Hulala 0.3.35 puts the rail, the conversation and the side column on Ctrl-H and Ctrl-L, so switching panels no longer needs a Command chord.
date: 2026-11-23
version: 0.3.35
---

## The key that never arrived

You are in a terminal, in the middle of a turn, and you press `Shift-Cmd-H` to
move the keyboard back to the composer. Nothing happens. You are on a machine
reached over ssh, or in tmux, or in the one terminal app nobody wrote a keyboard
protocol for, and a `Cmd` chord is not a thing that can be sent. `Ctrl-Shift-H`
is the spelled-out fallback, and in a legacy encoding that one sends no
modifier at all, so it is not a key either.

That is the whole problem this release answers: the layout was reachable only
from terminals that answer the Kitty keyboard report. 0.3.35 moves every layout
gesture onto a plain `Ctrl` letter, so the same keys work over ssh.

## Why a Command chord is not a key

A terminal emulator has two ways to tell a program about a key. The old way is a
byte: `Ctrl-H` is `0x08`, `Ctrl-M` is `0x0d`, `Ctrl-[` is `0x1b`. The new way is
a report the program has to ask for, and only then can a terminal say "this was
`Cmd`+`Shift`+`H`, and it is a press, not a repeat".

Hulala has been asking for that report since it shipped. Ghostty, kitty, WezTerm
and iTerm2 answer; Terminal.app, an ssh session and most combinations inside tmux
do not. When the report is absent, the client sits in front of a keyboard whose
chords collapse into bytes it cannot distinguish, and a shortcut that needs three
keys on a US keyboard is a shortcut nobody presses twice.

We looked at the other direction first: keep the Command chords and ask people to
rebind their terminal. That works on one machine and fails on the next, and the
reply we kept hearing was "I use this over ssh". A keybinding that depends on the
outer terminal's configuration is not a keybinding, it is a preference.

## The one-modifier layout

Every layout key now starts on `Ctrl` and names the thing it moves:

- `Ctrl-H` / `Ctrl-L` move the keyboard between the Session rail, the conversation and the painted column.
- `Ctrl-S` shows or puts away the Session rail.
- `Ctrl-,` / `Ctrl-.` open the previous and next Session; `Ctrl-↑` / `Ctrl-↓` do the same when the terminal cannot report a comma with `Ctrl`.
- `Ctrl-T` and `Ctrl-D` are unchanged: the built-in terminal and Neovim.
- `Ctrl-Shift-D` leaves only Neovim, so the letter names the column key it leaves alone.
- `Cmd-L` and `Ctrl-Shift-L` repaint the screen. `Ctrl-L` used to do it, and `Ctrl-L` is now the rightward move.

The old chords still work. `Shift-Cmd-H` / `Shift-Cmd-L` / `Shift-Cmd-S` are
alternates, and `/rail`, `/chat`, `/nvim` and `/sessions` need no keyboard report
at all.

## What a program inside a column still owns

`Ctrl-H` is `0x08`, which a program in a column reads as `<C-h>`, the alternate
backspace. The client takes it anyway, because otherwise there is no byte that
gets the keyboard out of a program. Backspace itself is a different byte
(`0x7f`) and keeps deleting characters in Neovim and in your shell.

`Ctrl-S` is the one exception in the other direction. The shipped Neovim
configuration maps `<C-s>` to `:write`, so while the editor column has the
keyboard the byte stays Neovim's and the rail key does nothing there. In the
terminal column the client keeps it, because a shell reads `C-s` as flow control,
which freezes the output until `C-q` instead of running a command.

`Ctrl-L` is not taken from a focused column, because a column is the rightmost
thing on screen and there is nothing to its right. In Neovim it is still the
redraw.

`Ctrl-I` is still not bound to anything, and never will be: it is the `Tab` byte.
Neither is `Ctrl-[`, which is `Esc`.

## What this release does not fix

`Ctrl-,` and `Ctrl-.` are only distinct from the comma and the period under the
keyboard report. On a terminal without it they do nothing at all, which is why
`Ctrl-↑` and `Ctrl-↓` are bound to the same two actions.

`Ctrl-Shift-D` degrades differently. In a legacy encoding `Ctrl-Shift-D` is the
`Ctrl-D` byte, so on such a terminal it toggles the editor column instead of
leaving it alone; `/nvim` is the spelling that never depends on the report.

If you use Ghostty, note that it claims `super+shift+d` for its own
`new_split:down` and `super+shift+arrow_up` for `jump_to_prompt`, so those two
Command spellings need a `keybind = …=unbind` line in its config before they
arrive. The `Ctrl` spellings need no configuration.

## Seeing it and changing it

`/keys` prints every action with the keys in force, which is the fastest way to
check what a build actually bound. Your own file is
`~/.hulala/config/keybindings.json`, the same schema the defaults use, and
`/keys` rereads it without a restart:

```json
{
  "panel.focusLeft": ["ctrl+h"],
  "panel.rail": ["ctrl+s"]
}
```

The rest of 0.3.35 is quieter. The first block of a new Session now says what
that Session loaded, its skills and the MCP servers its directory declares, with
the answers coming from the Host rather than the window. A dialog dims the frame
behind it and keeps the keyboard until it is answered, and a Kitty-image logo is
no longer left behind in Ghostty after the client exits.

Grab it with [install Hulala](/download/) or `hulala update`, or read [why the
panel keys left the Ctrl bracket](/blog/ctrl-bracket-is-escape/) in 0.3.34.
