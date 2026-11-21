---
slug: approval-survives-a-dropped-ssh
title: Your approval survives a dropped ssh
description: A dropped ssh forward no longer loses your approval answer. Hulala resends your choice when the Host comes back, and f now grants the whole Session full access.
date: 2026-11-21
version: 0.3.32
---

## The prompt that hangs after y

You are working on a dev box. The Session is attached with `hulala ssh dev`, and
the model asks to write a file outside the workspace. The approval card appears at
the bottom of the transcript. You press `y`.

The card closes. The command does not start. The transcript says the connection
dropped, and the turn sits there with no error and no result. The Host still lists
the approval as pending; the tool is waiting for a decision that never arrived.

The answer was not lost because you pressed the wrong key. An approval answer does
not travel back on the socket that delivered the question. The client sends it as
one HTTP POST to the Host. Over an ssh forward, that POST can land while the
forward is being rebuilt, or after a credential exchange has given the HTTP side a
different Host-side identity than the event socket. The Host refuses the result,
and the client treats that refusal as a broken event connection. Everything on
that stream stops: the approval card, the live question, the tool state. The
pending approval on the Host has nobody left to answer it.

That is why pressing `y` again after reconnecting sometimes worked and sometimes
did not. The card had come back, but the credential and the socket were not always
back on the same identity.

## Keep the answer, not the socket

0.3.32 changes the order of two things. First, the client no longer exchanges its
Host credential while the mux socket is live. If an exchange races the reconnect,
the socket is replaced so the HTTP side and the event stream speak for the same
Host-side Peer. That removes the refusal rather than recovering from it.

Second, an approval answer is now worth keeping. The client remembers the choice
against the tool call id. If the transport dies before the Host receives the
result, the Host keeps the pending approval and replays it on the next event
stream. The client recognises the replay, applies the same choice, and only then
lets the card go. A lost Session-wide grant is re-applied too, so pressing `f`
once does not need to be pressed again after a reconnect.

The result POST also has a ten-second deadline. A forward that accepts the
connection and then goes silent used to hold the answer open for minutes, which
looked exactly like a hung agent. Ten seconds is far longer than a loopback POST
needs and short enough to end the generation, reconnect, and replay the pending
approval.

When a card's delivery dies, the transcript now says it will return. That sentence
is small, but it is the difference between "the tool is thinking" and "the tool is
waiting for you on a card that vanished".

## The whole Session, in the footer

The other half of this release is about a choice that already existed but was hard
to find. Since 0.3.19, `f` in the approval card has run the Host's
`/permission danger-full-access`: the sandbox stops restricting file writes and the
approval policy becomes `never` for this Session, so every later turn runs without
a permission prompt. New Sessions keep their own default.

What changed is where the choice appears. It used to be a dim line in the card's
body while the footer listed only allow-once, reject and cancel. Now the footer
carries it:

```text
[y] allow once  [f] whole Session  [n] reject  [Ctrl-C] cancel
```

The hint above it says that later turns in this Session stop asking. Choosing it
still answers the pending call once and switches the Session, so the operation you
were approving runs, and the next one does not ask. `/permission workspace-write`
switches the Session back at any time.

Use it when the work is genuinely outside the workspace for the rest of the
conversation: a deploy directory, a system service, a config file that lives
beside the repository. Do not use it as a default. It is a Session-wide switch,
and the next Session starts from your configured default again.

## How to see it

Update, attach to a machine, and ask for a write outside the workspace:

```sh
hulala update
hulala ssh dev
```

The approval card appears. Press `f`, and the same command runs; the next command
that needs the same permission runs without a card. If you want the prompts back,
run `/permission workspace-write` in the composer.

The reconnect path is harder to stage on purpose, so here is the observable part.
Stop the ssh forward while a Session is waiting on an approval, then let it come
back. The card disappears with a notice, returns when the Host replays the pending
approval, and the choice you already made is sent without a second keypress. If
the machine is gone for more than ten minutes, the client stops trusting the old
answer and asks again; a decision is not remembered forever.

There is one limit worth naming. This release makes the answer survive a broken
connection; it does not make a machine that is actually down reachable. If the
Host process is gone, the card waits until the Host is back, the same as any other
Session state.

If you have not installed Hulala yet, [it goes in with one command](/download/).
If you are coming from the previous release, [0.3.31 put the machine in the
tab](/blog/the-window-names-the-machine/); this one keeps the approval answer
alive on the way back.
