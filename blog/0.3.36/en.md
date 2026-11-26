---
slug: the-picture-the-agent-read
title: The picture the agent read, in the terminal
description: Hulala 0.3.36 draws a tool result's image in the conversation, and opens a file link from the transcript in the editor column beside it.
date: 2026-11-26
version: 0.3.36
---

A terminal shows a line of text where an agent's image should be because a tool
result carries a reference, not pixels, and Hulala printed the reference. 0.3.36
asks the Host for the bytes and draws the picture under the tool row, over ssh
too.

## The line where the screenshot should be

You paste a screenshot, or ask the agent to read one, and it answers about what
is in the picture. The conversation itself prints this:

```
[Image: shot.png [image/png] 800x600]
```

Nothing failed. `read_image` commits the file to the Host's attachment store and
returns a reference, which is small and durable and names an object on the
machine that owns the Session. The client drew the reference and stopped there.
The pixels had been on the Host since the read, and nothing asked for them.

## What the row does now

A tool result that carries an image draws the image under its own row. On a
terminal that speaks the Kitty graphics protocol (Ghostty, kitty, WezTerm and
Warp) the pixels are placed in the frame: the QR code in a result is a QR code
you can point a phone at, and a screenshot comes back at the size it was taken.

The bytes come back through the Session's own attachment route, so a Host on
another machine behaves exactly like a local one. That is the part worth
knowing: the drawing is the only thing that crossed the wire, and no file is
read by the window you are looking at.

The read happens once per attachment. The same picture in two tool rows is
placed once, and the transcript keeps the lines it drew, so scrolling back does
not put a row back on the Host for bytes it already had.

Kitty transmits PNG and nothing else, so a JPEG, a WebP or a GIF is re-encoded
first. The converter is about a megabyte of WebAssembly, loaded on the first
non-PNG image rather than at startup, and a photo's EXIF orientation is applied
on the way; without that, a portrait shot from a phone lands sideways. A result
may claim 60 columns and 30 rows, which is where a tall phone screenshot stops
swallowing the turn it belongs to.

In a terminal without the graphics protocol you keep the reference line, and the
client never asks for the bytes at all. That is a smaller download, not a
degraded frame: `[Image: photo.jpg [image/jpeg] 800x600]` says what exists and
where it came from.

## Clicking a link in the conversation

The second half of this release is the other thing a conversation names: a
target. The rule is that a link is opened by the machine that owns it, not by
the machine that happens to be painting the frame. Hulala is two processes, and
they are the same computer only sometimes.

So a URL goes to the browser in front of you. It is location-independent, the
far machine has no browser, and `https://` means the same thing on both sides of
an ssh connection.

A path goes to the Host. The Host resolves it against the Session's directory
and confines it to the workspace, then answers with the absolute path it found,
and the editor column opens that path; the column's Neovim is a Host program, so
this is still one resolution. A link whose target is a bare file name works
because of that: `[notes](2026-11-24-trader-trade-memory.md)` resolves next to
the Session, not next to the window.

Two failures say so instead of doing nothing. A target that does not resolve
gets `can't open notes.md: <reason from the Host>`, and a browser that never
started gets its own notice. Neither leaves a click looking ignored.

## What it still does not do

Terminal.app and iTerm2 keep the reference line. The alternate screen only keeps
placements for the Kitty protocol, and a fallback that lies about what it drew
is worse than one that names the file.

A path outside the Session's workspace is refused by the Host, which is the same
wall the file tools have always had. And an image is only drawn as a tool
result; a picture mentioned in prose stays a link.

The rest of 0.3.36 is quieter: each panel now has one key that cycles it
(`Ctrl-D` the rail, `Ctrl-F` the conversation, `Ctrl-T` the terminal and `Ctrl-G`
Neovim), `/permission` is one picker with `Enter` and `Ctrl-S`, and an approval's
reason wraps instead of ending in `…` at the border of its dialog.

Grab it with [install Hulala](/download/) or `hulala update`, or read [how the
panel keys moved off the Command chords](/blog/panel-keys-without-a-command-key/)
in 0.3.35.
