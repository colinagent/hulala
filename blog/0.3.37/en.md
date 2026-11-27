---
slug: permission-default-new-sessions
title: Why every new chat asks for permission again
description: Hulala 0.3.37 says whether a permission change covers this Session or new Sessions too, and refuses a preset the Host cannot default to.
date: 2026-11-27
version: 0.3.37
---

Because `/permission` had two writes and one sentence for both. `Enter` widens
the Session you are in; only `Ctrl-S` also changes what new Sessions start at.
0.3.37 makes the notice say which one happened, names the preset a new chat will
still get, and marks that preset in the list.

## Which one did I just change?

You open `/permission`, pick Full access, press `Enter`, and the agent stops
asking. The next conversation asks again. Nothing lied to you, but the line you
read was `permission: Full access`, which sounds like a setting, not like a
Session. The only place the difference was written down was a `default` badge on
another row of the same list, and a notice that scrolls away.

The new notice names both facts and the key that moves the second one:

```
permission: Full access for this Session · new Sessions: Workspace Write · Ctrl-S stores it
```

When the preset you picked is already the default, it says so instead of nagging:

```
permission: Full access · new Sessions too
```

And `Ctrl-S`, which writes both, reports both:

```
permission: Full access · this Session and new Sessions
```

## How do I check it without trusting a notice?

Two places now. The list itself marks the row a new Session will start at, in
front of its consequence, so a narrow terminal truncates the sandbox note before
it truncates this:

```
 → ✓ Workspace Write  default for new Sessions
     Full access      approvals off · no write sandbox
```

And `/status` prints the pair as two adjacent rows, which is the only version of
the fact that survives after the notice is gone:

```
permission Full access
default    Workspace Write
```

`/status` asks the Host each time, so it is correct even if another window, the
web client or a bot Session changed the default in between.

## Why not make Enter set the default too?

Because a one-off widening is the common case, not the exception. You need Full
access for one deploy in one directory, and you do not want every later
conversation to start unconfined because of it. pi's selectors already split the
two gestures: `Enter` picks for now, `Ctrl-S` also stores the choice. Hulala keeps
that split because it is the only way to express "just this time".

The web client solves the same problem differently: it has two surfaces, a
General-settings row that writes only the default and a `/permission` popup that
only switches the Session, so nobody has to learn a modifier key. The terminal
has no settings page, and adding one for a single row would add a second place to
look. We kept one panel and made it say what it did.

## What will it refuse to store?

A preset the Host registers while it runs, such as the Auto review integration,
is offered for a Session but cannot be a default: the Host resolves a default
against its configured preset table, and a name outside that table makes every
later permission read and every new Session fail with `unknown default preset`.
Before 0.3.37, `Ctrl-S` on such a row wrote that name anyway, because the settings
field takes any string.

Now the row is marked `this Session only`, and `Ctrl-S` switches the Session,
leaves the default alone, and says why:

```
permission: Auto review · new-Session default unchanged: the Host does not accept this preset as a default
```

That is the same guarantee the web settings row gives by offering only configured
presets in its menu.

## What this release still does not do

It does not change the permission of a Session that already exists. A Session pins
its preset when it is created, so the conversations you have open right now keep
asking until you run `/permission` in each of them; the default only decides what
the next one starts at.

It does not add a confirmation dialog before storing Full access. We looked at the
web client, which requires an acknowledged risk checkbox on both paths, and kept
the terminal's answer: the row states the consequence, the notice states the
scope, and `/status` keeps both readable. Adding a gate back would make the
approval dialog's `f` key the odd one out again, which is why 0.3.36 removed it.

And it does not make the setting global across machines. The default lives on the
Host, so a laptop and a box you reach over ssh keep their own; a new Session on
either one follows that Host's value.

To get the change, run `hulala update`, or install it from
[the download page](/download/) with:

```sh
curl -fsSL https://hulala.ai/install.sh | sh
```

Then open `/permission` once, pick Full access, and press `Ctrl-S`. Reopen the
list: the badge under Full access is the proof that the next conversation starts
there.
