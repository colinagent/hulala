---
slug: ctrl-bracket-is-escape
title: Ctrl-[ is Esc, so the panel keys moved
description: Ctrl-[ is the Esc byte on most terminals, so it aborted the running turn. The panel moves are now Shift-Cmd-H and Shift-Cmd-L.
date: 2026-11-22
version: 0.3.33
---

## The turn that stopped while you were typing

You are half way through a conversation. The model is still working, the
transcript is above you, and you want to look at the Session list before the
answer lands. You press `Ctrl-[` to move the keyboard left. The transcript prints
`Turn cancelled`, and the work stops.

If you type Chinese, this happens more often than you would like. Your input
method owns `Esc` for cancelling a composition, so `Esc` feels like a key you
handle, not a command you send; `Ctrl-[` is the same key by another name. On a
terminal that answers no keyboard report the two are literally one byte:
`matchesKey('\x1b', 'escape')` is true, and so is `matchesKey('\x1b', 'ctrl+[')`.
The client bound `Esc` to "cancel the running turn" and `Ctrl-[` to "move the
keyboard left", and every press satisfied both.

## One byte cannot carry two jobs

The first attempt at this was to teach the client the difference. A terminal that
was asked for the disambiguated keyboard report sends `Ctrl-[` as its own
sequence, `CSI 91;5u`, and `Esc` as `CSI 27u`, so the two events really are
separable. That fix is in 0.3.33, and it was not enough on its own.

It was not enough because the terminal is not always the thing that decides. An
input method can collapse the chord back to a bare `0x1b` before the terminal ever
sees a modifier, and Terminal.app and iTerm2 never take the report at all. In those
sessions `Ctrl-[` is `Esc` no matter what the client asked for, and a key that
means "move left" while it means "abort" is a trap you fall into on the day you are
in a hurry.

So the panel keys are not on a control byte any more. They are on chords that
belong to the client and to nothing else.

## What the keys are now

- `Shift-Cmd-H` and `Shift-Cmd-L` move the keyboard between the Session rail, the
  conversation and the sidebar. `Ctrl-Shift-H` and `Ctrl-Shift-L` are the same pair
  for a system where a Command chord never arrives.
- `Shift-Cmd-N` and `Shift-Cmd-P` open the next and previous Session from anywhere,
  in the rail's own order: this directory first, then the rest, newest first.
  Whether the rail is shown or folded makes no difference, so the key is the same
  gesture in every layout. Inside the rail, `Ctrl-N` and `Ctrl-P` still move the
  cursor. One pair moves Sessions, the other moves a highlight.
- `Shift-Cmd-K` opens the command palette. It used to be `Shift-Cmd-P`, which the
  previous Session key now needs; Ghostty 1.4 had already claimed `super+shift+p`
  for its own palette, so that key was dead in the terminal this release was tested
  in.
- `Shift-Cmd-I` is "just Neovim". It used to be `Cmd-E`, which Ghostty 1.4 also
  claims (`super+e` is `search_selection`). It is not `Ctrl-I` on purpose: in any
  legacy encoding that is the `0x09` byte of `Tab`, which would have taken Tab away
  from the completion menu, from a shell's completion and from Neovim's indenting.
- `Esc` is unchanged. It cancels a running turn, and with nothing running it moves
  the keyboard into the rail. Inside a focused column it still belongs to the
  program whenever the program has something to cancel, which is any mode of
  Neovim except normal, and any full-screen program in the terminal column.

Command first, Control second is deliberate. On macOS the Command chord is the
primary one; on Linux the window manager usually takes Super before the terminal
sees it, so the Control spelling is the one that arrives. `/keys` prints both,
along with whatever your own `keybindings.json` put in force.

## What still does not work

Terminal.app and iTerm2 never deliver a Command chord to the program running
inside them. If your terminal also answers no keyboard report, `Ctrl-Shift-H`
sends no bytes at all, so there is no move key rather than a wrong one. `Esc`
still takes you into the rail when the composer is idle, `/rail`, `/editor` and
`/terminal` still open their columns, and `/keys` is still the authority on what
is in force.

Your own `keybindings.json` can still bind `ctrl+[` if you want it. The client
will not argue; it is your byte, and now you know what else that byte means.

The other limit is the one this release does not fix: a key cannot tell you why it
did not arrive. When a Command chord does nothing on a machine whose terminal does
not speak the keyboard protocol, the client never sees the press, so it cannot say
so. `/keys` is the place to look, and the second spelling is the fallback on
terminals that do.

## How to see it

```sh
hulala update
```

Press `Shift-Cmd-H` while a turn is running: the keyboard moves into the rail and
the turn keeps going. Press `Esc` in the same position: the turn stops, as before.
Then open `/keys` and check the two spellings of each move, and `/help` for the
surrounding rules.

If you want to confirm what your own terminal sends, start the client with
`HULALA_DEBUG_CLIENT=1` and press the key. The log at
`~/.hulala/logs/tui-debug.log` prints the bytes: `CSI 104;10u` for `Shift-Cmd-H`,
`CSI 27u` for `Esc`, and a bare `\u001b` when the terminal or the input method
collapsed the chord.

## Why the whole keymap moved at once

Three of these fixes belong together, and shipping them one at a time would have
left a release where `Shift-Cmd-P` opened the palette while `Shift-Cmd-N` switched
Sessions, and where the move keys were the only ones still on a byte that belongs
to `Esc`. The changelog lists all four entries; this post is the reason behind
them.

If you have not installed Hulala yet, [it goes in with one command](/download/).
Coming from the previous release, [0.3.32 kept an approval answer alive across a
dropped ssh](/blog/approval-survives-a-dropped-ssh/).
