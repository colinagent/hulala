---
slug: terminal-stops-switching-input-method
title: Terminal stops switching your input method
description: Hulala 0.3.38 only touches the macOS input source while its window is in front, and no longer lets a test run change the keyboard on the machine running it.
date: 2026-11-27
version: 0.3.38
---

Because a background window was allowed to do it. Hulala changes the macOS
input source when a surface that reads keys as commands takes the keyboard, and
it had no way to know whether anyone was looking at it. 0.3.38 reads the
terminal's focus reports and leaves the keyboard alone when the window is in the
background.

## What was switching it

You are typing Chinese in another window. The terminal running Hulala is behind
it, holding an approval card nobody has answered yet. The input source flips to
ABC under your fingers, and your input method answers with a notice about a
shortcut conflict when it is selected again a few minutes later.

That is not a shortcut conflict. The client had asked the system to select a
layout, at a moment when the window was not the one you were typing into. The
system log shows the helper being spawned from the client's process, and the
client had no idea the window was behind another application.

## Why it could not know

A terminal program sees bytes from its pty. It learns that the window moved
behind another app only if the terminal tells it, through focus reporting (`DEC
?1004`): `ESC [ I` when the window gains focus, `ESC [ O` when it loses it.

We had that mode turned off — deliberately, because each report is another
sequence that can be split by a read and typed into the composer as garbage.
Turning a mode off removes the garbage and removes the knowledge with it. The
probe that proved this is a two-line change in the terminal: enable the mode,
and read the reports before the screen does.

## What changed

The reports now have an owner. The client's terminal wrapper recognises
`ESC [ I` and `ESC [ O` as input arrives, records the state, and hands the bytes
on to the screen, which consumes them exactly as before. Nothing new can be
typed, because nothing new reaches the composer.

The input-source ownership asks that state before it does anything:

- the window is in front and a command surface has the keyboard: switch to a
  layout, as before;
- the window loses focus: give the user's own source back immediately, instead of
  holding it until the surface goes away;
- a policy change while the window is in the background: call nothing at all.

The last line is the one that fixes the story above. A card appearing in a
window nobody is looking at no longer selects anything.

Terminals that never send focus reports keep the old behaviour: the client
assumes it is in front, which is what every machine had before this release.

## The test suite stopped touching your keyboard too

The second half of the same problem was ours. The end-to-end suites start a real
client on a pty with a temporary state root, and that client published its
input-source helper into the temp root and then used it. One `bun run test` on
macOS selected a real system source twenty-one times in seven seconds. If you
run the suite while the tests are being written, your keyboard is the test
fixture.

A temporary state root is an automated run now: it never takes the input source,
and `HULALA_INPUT_SOURCE=0` or `1` states the answer explicitly for any other
harness. The same suite now makes zero selections.

## Which layout it picks

The helper asks macOS for a keyboard layout, preferring one whose declared
languages include English. No vendor and no layout id is hard-coded: a
third-party English layout works, and a machine that removed ABC and US still
finds a layout rather than switching to nothing.

English is the preference, not the rule. Any keyboard layout reads keys as
characters instead of composing them, which is the property a command surface
needs; other layouts move punctuation and `y`/`z`, which is worse than useless
for a vim motion. Giving the source back is a different mechanism: the client
remembers the id the system reported before its switch — Doubao, Sogou, Apple
Pinyin, anything — and selects that exact id again, after checking that its own
change is still in force.

## What still happens

A focused command surface still switches to a layout. That is the feature: in
Neovim's normal mode, the rail, a selector or an approval, a Chinese input method
would eat `j`, `Enter` and `Esc` into a composition string. The voice key of an
input method also only works while that input method is the selected one, so a
command surface that forces a layout is not the place for dictation.

Two smaller things ride along in this release. The footer no longer appends the
Session's permission preset after the model — configuration lives in
`/permission` and `/status`, not in a row of running figures. And a tool result
that carries a picture now stays on screen while any part of it is still in
view; scrolling no longer takes the whole image with it.

To get the change, run `hulala update`, or install it from
[the download page](/download/).
