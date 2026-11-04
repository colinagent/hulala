# Brand assets

The Hulala mark is the four-blade pinwheel. Everything here is derived from the
same four paths; nothing is redrawn by hand.

| File | Use |
|---|---|
| `hulala-logo-v2.svg` | **Master mark.** Transparent, 512×512 canvas with the mark at its natural margins. Source of truth for every other render. |
| `logo-mark-terminal.svg` | Terminal variant. Same four blades, three changes (below). Source for the PNG. |
| `logo-mark-terminal.png` | 512×512 RGBA raster of the variant above. **The single canonical bitmap for CLI, installer banner and terminal image protocols** (`hulala --version`, `install.sh`, kitty graphics). 512 is deliberate: terminals downscale to the requested cell box, so one file serves every size. |
| `otter-logo-black.png`, `otter-logo-white.png` | Previous otter mark. Retired; kept only as history, do not use in new work. |

The website renders the same master mark through `apps/website/public/logo-mark.svg`
and `apps/website/public/logo.svg` (the latter adds the theme-aware rounded tile).

## Why the terminal variant differs

The mark cannot be shown as-is in a terminal, for reasons that are physical
rather than stylistic:

1. **The hub disc is cut out, not painted.** In the master mark the plate behind
   the hub is paper white. A terminal has no paper: a white disc lands as a white
   square hole punch on whatever background the user runs, which looks broken on
   every dark colour scheme. The variant masks the disc out so the terminal
   background shows through, and keeps the small taupe dot inside it.
2. **The paper grain is dropped.** It is a 7%-opacity dot pattern; below roughly
   512 px it is sub-pixel noise that only adds file weight.
3. **The viewBox is cropped and squared to 422×422.** The master canvas carries
   ~20% margin, which a terminal would honour as empty cells around the logo. A
   square viewBox also keeps the mark undistorted when rasterised to an exact
   square, which is what a 2:1 character cell needs.

## Regenerating the PNG

The PNG is checked in, so builds never need an SVG rasteriser. After editing
`logo-mark-terminal.svg`, regenerate it and commit the result:

```bash
rsvg-convert -w 512 assets/brand/logo-mark-terminal.svg -o assets/brand/logo-mark-terminal.png
```

`rsvg-convert` ships with librsvg (macOS: `brew install librsvg`, Linux:
`librsvg2-bin`). On CI or a machine without it, `resvg` gives the same output:
`resvg --width 512 --height 512 in.svg out.png`.

Do not use macOS `qlmanage` for this: it renders SVG thumbnails onto an opaque
white matte, which silently destroys the alpha channel.

## Checking a render

```bash
# real terminal image (Ghostty, kitty, WezTerm)
chafa --format kitty --size 20x10 assets/brand/logo-mark-terminal.png
# characters, for terminals without a graphics protocol
chafa --symbols braille --size 32x16 --colors none assets/brand/logo-mark-terminal.png
```
