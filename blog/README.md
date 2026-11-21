# The release blog

One post per release, in both languages, for the person deciding whether to run
`hulala update`. The site renders these files at `https://hulala.ai/blog/` and
`https://hulala.ai/zh-CN/blog/`; nothing here is copied into the site by hand.

## Shape

```
blog/<version>/en.md
blog/<version>/zh-CN.md
```

- The directory is the released version (`x.y.z`), and the frontmatter must agree
  with it. A release has at most one post; a second directory for the same version
  is an error.
- Both files are required. They are two originals, not a translation pass: the
  Chinese post is written in Chinese and makes the same claims.
- `en.md` and `zh-CN.md` share `slug`, `date` and `version`; `title`,
  `description` and the body belong to their own language.

## Frontmatter

```
---
slug: the-window-names-the-machine
title: The window names the machine
description: One sentence, in the post's own language, that the index card can print.
date: 2026-11-21
version: 0.3.31
---
```

`slug` is the URL (`/blog/<slug>/`): lower-case words joined by single dashes, and
it never changes once published. `date` is the day the release ships.
`description` is what the index card and the social preview show.

## What a post says

1. **What it is worth to you.** The problem the reader had before, in their own
   situation — a tab you cannot identify among five windows, a light-theme session
   with a dark slab in the middle of it.
2. **Why it is built this way.** The trade-off that was made, and the alternative
   that was rejected.
3. **What it is for.** What the reader can now do, and what stays the same.

Write only about what the tag actually carries. No "coming soon", no promise for
the next release, no description of a feature that only exists on `main`. No
repository paths, internal plans, credentials or private links: this directory is
in the public repository and the site is public.

## Body syntax

The site's renderer accepts a deliberate subset, and a construct outside it fails
the website build instead of rendering as literal asterisks:

- `##` and `###` headings (the frontmatter title is the `h1`)
- paragraphs
- `-` and `1.` lists
- fenced code blocks with an optional language
- `>` blockquotes
- `---` rules
- inline `**bold**`, `*italic*`, `` `code` ``, `[text](https://…)`

## Checking

```sh
bun run check:blog                    # structure and bilingual parity, every post
bun run check:blog --version 0.3.31   # this release has a post (the tag gate)
bun run --cwd apps/website build      # both language pages render
```

The gate checks that both locales exist and agree on `slug`, `date` and
`version`, that the post is not a stub, and that the tag being released has one;
the website build proves the Markdown renders.
