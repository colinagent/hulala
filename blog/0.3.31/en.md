---
slug: the-window-names-the-machine
title: The window names the machine
description: 0.3.31 puts a remote Session's ssh alias in the tab, gives the Session rail a row back, and draws archived prompts on your terminal's own page.
date: 2026-11-21
version: 0.3.31
---

## A tab is an address

Five windows are open: a shell, an editor, and three Sessions on three different
machines. You switch to one and type. If you picked wrong, nothing complains. The
command runs on the box you did not mean, and you find out from its output.

Everything else in Hulala is careful about *where* work happens. One state root,
one Host per machine, `/remote` when you want another one. The window title was
the one place that did not say it, so this release starts there.

## The machine comes before the directory

A remote window's tab now opens with the machine, written the way `scp` writes a
remote path:

```text
root@dev:pi - Hulala:Fix the composer
```

Left of the colon is the ssh alias you attached through, right of it is the
directory the Session works in. Below the colon and after the product name is the
Session's own name, once the Host has given it one. Before this release the title
was `Hulala - pi - Fix the composer` on every window, local or remote.

The order matters when the tab is truncated. A tab is often cut to its first
twenty columns by the window manager or the terminal itself, so the two facts that
identify the window come first and the Session's name comes last. A local window
keeps the short form, because the directory alone is this machine:

```text
pi - Hulala:Fix the composer
```

Writing `colin@laptop:` in front of every local tab would be noise. The machine is
named only when it is not this one, which is exactly when you can get it wrong.

## The account is read, not guessed

The alias is the name you gave the machine, so that is what the title shows, not
the address ssh resolves it to. The account comes from `ssh -G <alias>`, the
configuration `ssh` itself would use, resolved without opening a connection.

That detail matters more than it looks. Naming a machine must not wake a sleeping
box, add latency to a title, or trust a host key that no connection asked for. A
window that attached to an alias with no `user` line still gets a usable label,
`dev:pi`, rather than an empty `@`; nothing here reaches the network.

## How to see it

Update, then open a local window and a remote one:

```sh
hulala update
hulala ssh devbox      # any alias in your own ~/.ssh/config
```

The local tab reads `workspace - Hulala`. The remote one reads
`you@devbox:workspace - Hulala`, or `devbox:workspace - Hulala` when the alias
resolves no account. Hide the rail, or switch to another tab and come back: the
machine is still in the title, because the title does not depend on anything
inside the window being visible.

## Why the rail lost a row

The Session rail used to spend a row on the machine. The row was right and in the
wrong place. The machine is what you need while you are *not* looking at the rail:
when the rail is hidden, when the window is one of five, when the window switcher
shows four truncated titles. A terminal title is the only surface that survives
all three, and it survives them per window instead of per application.

So the row is gone and the fact is not. The rail gets its row back for Sessions,
and the machine moved to the only text the operating system already shows outside
the app. `/remote` still switches an open window, `hulala remote <ssh>` still
opens one on another machine, and the title follows along when you switch.

## The prompt belongs to the page

An archived prompt used to be drawn as a fixed chip. On a dark theme it read as a
card. On a light theme it was a dark slab in the middle of the transcript: a
colour the terminal had not chosen, on a page the user had.

The band is now the editor's level-2 heading tint. It is your page's own
background moved a tenth of the way towards the palette's yellow, with the page's
text ink on top and an arrow faded back into the band. The conversation and a `##`
heading in the editor column are one colour family because they are one palette,
not two literals that happen to match today.

There is one limit, and it is on purpose. This is not a theme the client invents.
It is derived from what the terminal actually reports. A terminal that reports no
page keeps the fixed chip, because a guess would be a second, invisible theme, and
a light theme that lost its background would then be painted twice over.

## What to do with it

If you have not installed Hulala yet, [it goes in with one command](/download/).
If you have, update and look at a tab:

```sh
hulala update
```

With a light terminal theme, the transcript no longer has a dark block in it. With
several windows open, a remote tab now says which machine it is on before it says
anything else. There is nothing to configure: this release adds no setting, no
migration and no new daemon.

One question is worth asking of any change like this: did the information move
somewhere you will actually be when you need it? That is the whole release. The
machine moved into the tab, the rail got its row back, and the prompt moved onto
your page.
