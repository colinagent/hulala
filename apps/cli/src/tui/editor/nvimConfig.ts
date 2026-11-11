/**
 * The Neovim config Hulala ships with the editor column.
 *
 * Kept as strings rather than loose files so the single-file client bundle
 * carries them. Two files land in `<data>/config/editor/nvim/`:
 *
 * - `hulala.lua` is {@link NVIM_BASE_LUA}: the settings the client owns (theme,
 *   autosave, the file tree, the pickers, the Markdown renderer). It is rewritten
 *   whenever its content changes, because a fix that never reaches an existing
 *   installation is not a fix. The client also loads it through `nvim --cmd`
 *   before Neovim reads any user config, so installations whose `init.lua` was
 *   written by an older client still get it.
 * - `init.lua` is {@link NVIM_INIT_LUA}: written once and never overwritten, so
 *   a user can edit it and keep those edits across upgrades. It only loads the
 *   base config, and the base guards against being loaded twice.
 *
 * Everything configurable arrives through the environment so the config holds no
 * hardcoded palette: `HULALA_NVIM_THEME` is the JSON from
 * {@link editorThemeFromTerminal} and `HULALA_NVIM_SNACKS` is the vendored
 * plugin directory. Without the plugin the file tree falls back to netrw.
 *
 * @module hulala-cli/tui/editor/nvimConfig
 */

/**
 * Lua source of the user's `init.lua`.
 *
 * Deliberately short: it names where Hulala's own settings live and gets out of
 * the way, so the half a user may want to change is not buried in four hundred
 * lines they did not write.
 */
export const NVIM_INIT_LUA = `-- Your Neovim settings for Hulala's editor column.
--
-- Hulala writes this file once and never overwrites it, so anything you add here
-- survives an upgrade. Hulala's own settings (theme, autosave, the file tree,
-- the pickers) live in \`hulala.lua\` in this directory; the client rewrites that
-- file, so change behaviour here rather than there.
local base = vim.env.HULALA_NVIM_CONFIG
if base ~= nil and base ~= "" then pcall(dofile, base) end
`

/** Marker line of the base config, used by the tests. */
export const NVIM_BASE_MARKER = 'Hulala editor settings'

/** Lua source of the settings Hulala owns. */
export const NVIM_BASE_LUA = `-- ${NVIM_BASE_MARKER}. Written by the Hulala terminal client and rewritten
-- whenever they change; add your own settings to \`init.lua\` instead. Loaded
-- before that file, and again by it, so this guard keeps autocmds single.
if vim.g.hulala_editor_settings then return end
vim.g.hulala_editor_settings = true

local function theme_value(key, fallback)
  local encoded = vim.env.HULALA_NVIM_THEME
  if encoded == nil or encoded == "" then return fallback end
  local ok, decoded = pcall(vim.json.decode, encoded)
  if not ok or type(decoded) ~= "table" then return fallback end
  local value = decoded[key]
  if type(value) == "string" and value ~= "" then return value end
  return fallback
end

local bg = theme_value("background", "#1b1d23")
local fg = theme_value("foreground", "#c8d3f5")

-- Match Neovim's own defaults to the background lightness we were given.
local function luminance(hex)
  local r = tonumber(hex:sub(2, 3), 16) or 0
  local g = tonumber(hex:sub(4, 5), 16) or 0
  local b = tonumber(hex:sub(6, 7), 16) or 0
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
end
vim.o.background = luminance(bg) > 0.5 and "light" or "dark"

vim.g.mapleader = " "
vim.g.maplocalleader = " "

local options = {
  number = true,
  signcolumn = "auto",
  termguicolors = true,
  mouse = "a",
  scrolloff = 6,
  sidescrolloff = 8,
  undofile = true,
  swapfile = false,
  backup = false,
  laststatus = 3,
  showmode = false,
  cursorline = true,
  splitright = true,
  splitbelow = true,
  expandtab = true,
  shiftwidth = 2,
  tabstop = 2,
  smartindent = true,
  ignorecase = true,
  smartcase = true,
  fillchars = "eob: ,fold: ,diff: ",
  list = false,
  updatetime = 300,
}
for name, value in pairs(options) do vim.opt[name] = value end
pcall(function() vim.opt.winborder = "rounded" end)
pcall(function() vim.opt.clipboard = "unnamedplus" end)

-- EPUB reading shells out to unzip. It is deliberately not bundled: it is a
-- per-platform system tool, and a release archive should not carry a private
-- build of it. Check it only when an EPUB is actually opened, so a machine
-- without it is not nagged on every editor start; the installer already tries
-- the platform package manager.
if vim.fn.executable("unzip") == 0 then
  vim.api.nvim_create_autocmd("BufReadCmd", {
    pattern = "*.epub",
    callback = function()
      local hint = "with your package manager"
      if vim.fn.has("mac") == 1 then hint = "with: brew install unzip"
      elseif vim.fn.executable("apt-get") == 1 then hint = "with: sudo apt-get install unzip"
      elseif vim.fn.executable("dnf") == 1 then hint = "with: sudo dnf install unzip"
      elseif vim.fn.executable("pacman") == 1 then hint = "with: sudo pacman -S unzip"
      elseif vim.fn.executable("zypper") == 1 then hint = "with: sudo zypper install unzip"
      end
      vim.notify("hulala: reading EPUB needs unzip — install it " .. hint, vim.log.levels.WARN)
    end,
  })
end

-- A committed quit: VimLeavePre only runs once Neovim has decided to leave,
-- so it never fires for a quit that E37 refused. The client waits on this file
-- instead of guessing with a timeout, which is what made a clean close look
-- unsaved when the plugins took a second to shut down.
if vim.env.HULALA_NVIM_LEAVE_FILE ~= nil and vim.env.HULALA_NVIM_LEAVE_FILE ~= "" then
  vim.api.nvim_create_autocmd("VimLeavePre", {
    callback = function() pcall(vim.fn.writefile, { tostring(vim.fn.localtime()) }, vim.env.HULALA_NVIM_LEAVE_FILE) end,
  })
end

-- Remember which files were open, so reopening the editor after a normal exit
-- brings the buffer list back. The percent item is the only addition to
-- Neovim's default shada set.
vim.opt.shada = { "!", "'100", "<50", "s10", "h", "%" }

local highlights = {
  Normal = { fg = fg, bg = bg },
  -- The file tree and the pickers are one tinted surface of their own: a step
  -- away from the editor, and the same whether the tree is a float or a window
  -- beside a file. Only the row under the keyboard changes shade.
  NormalFloat = { fg = fg, bg = theme_value("pmenu", bg) },
  FloatBorder = { fg = theme_value("border", fg), bg = theme_value("pmenu", bg) },
  FloatTitle = { fg = theme_value("title", fg), bg = theme_value("pmenu", bg) },
  Cursor = { fg = bg, bg = fg },
  CursorLine = { bg = theme_value("cursorline", bg) },
  CursorLineNr = { fg = theme_value("number", fg), bold = true },
  LineNr = { fg = theme_value("linenr", fg) },
  SignColumn = { bg = bg },
  Visual = { bg = theme_value("visual", bg) },
  Search = { fg = bg, bg = theme_value("search", fg) },
  IncSearch = { fg = bg, bg = theme_value("number", fg) },
  CurSearch = { fg = bg, bg = theme_value("number", fg) },
  Pmenu = { fg = fg, bg = theme_value("pmenu", bg) },
  PmenuSel = { fg = fg, bg = theme_value("pmenuSelected", bg), bold = true },
  PmenuSbar = { bg = theme_value("pmenu", bg) },
  PmenuThumb = { bg = theme_value("border", fg) },
  StatusLine = { fg = fg, bg = theme_value("cursorline", bg) },
  StatusLineNC = { fg = theme_value("comment", fg), bg = theme_value("pmenu", bg) },
  WinSeparator = { fg = theme_value("border", fg), bg = bg },
  VertSplit = { fg = theme_value("border", fg), bg = bg },
  Comment = { fg = theme_value("comment", fg), italic = true },
  Constant = { fg = theme_value("constant", fg) },
  String = { fg = theme_value("string", fg) },
  Character = { fg = theme_value("string", fg) },
  Number = { fg = theme_value("number", fg) },
  Boolean = { fg = theme_value("number", fg) },
  Identifier = { fg = fg },
  Function = { fg = theme_value("func", fg) },
  Statement = { fg = theme_value("keyword", fg) },
  Keyword = { fg = theme_value("keyword", fg) },
  Conditional = { fg = theme_value("keyword", fg) },
  Repeat = { fg = theme_value("keyword", fg) },
  Operator = { fg = theme_value("special", fg) },
  Type = { fg = theme_value("type", fg) },
  Special = { fg = theme_value("special", fg) },
  PreProc = { fg = theme_value("keyword", fg) },
  Error = { fg = theme_value("error", fg) },
  Todo = { fg = theme_value("number", fg), bold = true },
  Title = { fg = theme_value("title", fg), bold = true },
  Directory = { fg = theme_value("directory", fg) },
  NonText = { fg = theme_value("border", fg) },
  EndOfBuffer = { fg = bg },
  DiagnosticError = { fg = theme_value("error", fg) },
  DiagnosticWarn = { fg = theme_value("warn", fg) },
  DiagnosticInfo = { fg = theme_value("info", fg) },
  DiagnosticHint = { fg = theme_value("hint", fg) },
  DiffAdd = { fg = theme_value("added", fg) },
  DiffChange = { fg = theme_value("changed", fg) },
  DiffDelete = { fg = theme_value("removed", fg) },
  GitSignsAdd = { fg = theme_value("added", fg) },
  GitSignsChange = { fg = theme_value("changed", fg) },
  GitSignsDelete = { fg = theme_value("removed", fg) },
}
for group, spec in pairs(highlights) do
  vim.api.nvim_set_hl(0, group, spec)
end

-- Heading levels: every level carries its own ink and its own band, and both
-- step down from level 1. The ink is one hue mixed further towards the editor
-- background, the band is the background tinted with that hue. Deriving both
-- from the theme is what keeps "level 1 louder than 2, 2 louder than 3" true on
-- any terminal palette, instead of trusting six unrelated colours to happen to
-- sort that way.
local function blend(from, into, amount)
  local out = { "#" }
  for at = 2, 6, 2 do
    local a = tonumber(from:sub(at, at + 1), 16) or 0
    local b = tonumber(into:sub(at, at + 1), 16) or 0
    out[#out + 1] = string.format("%02x", math.floor(a + (b - a) * amount + 0.5))
  end
  return table.concat(out)
end

-- Heading levels are told apart by hue alone: the ink is the palette colour
-- itself, nothing is mixed into it and nothing dims it.
--
-- The order is a taste, not a measurement. Yellow is the brightest hue a dark
-- palette has -- luminance is mostly the green channel, so no red or orange can
-- out-brighten it -- but level 1 reads louder in a warm ink than in a pale one,
-- so it gets the palette's red warmed towards its yellow, and yellow itself
-- introduces level 2.
local yellow = theme_value("number", fg)
local HUE_ORDER = {
  blend(theme_value("error", fg), yellow, 0.5),
  yellow,
  theme_value("string", fg),
  theme_value("special", fg),
  theme_value("title", fg),
  theme_value("keyword", fg),
}
local BAND_TINT = { 0.12, 0.10, 0.08, 0.06, 0.05, 0.04 }

local function channel(hex, at)
  return tonumber(hex:sub(at, at + 1), 16) or 0
end

local heading_inks, heading_bands = {}, {}
for level, hue in ipairs(HUE_ORDER) do
  local spec = { fg = hue, bold = level <= 4 }
  vim.api.nvim_set_hl(0, "HulalaHeading" .. level, spec)
  -- The groups the text is actually drawn with: the editor highlights markdown
  -- with Vim's syntax files, where every level links to Title until we say
  -- otherwise. Treesitter captures are set too, for a highlighting path we may
  -- turn on later.
  vim.api.nvim_set_hl(0, "markdownH" .. level, spec)
  vim.api.nvim_set_hl(0, "markdownH" .. level .. "Delimiter", { fg = blend(hue, bg, 0.45) })
  vim.api.nvim_set_hl(0, "@markup.heading." .. level, spec)
  vim.api.nvim_set_hl(0, "@markup.heading." .. level .. ".markdown", spec)
  vim.api.nvim_set_hl(0, "HulalaHeadingBand" .. level, { bg = blend(bg, hue, BAND_TINT[level] or 0.04) })
  heading_inks[level] = "HulalaHeading" .. level
  heading_bands[level] = "HulalaHeadingBand" .. level
end

-- The file tree is one surface, and it carries two signals: the file the editor
-- is showing, and the row under the keyboard. Both are ink, never a filled row:
-- the client reserves background blocks for panels, and a band inside the tree
-- would split one column into two surfaces.
vim.api.nvim_set_hl(0, "HulalaTree", { fg = fg, bg = theme_value("pmenu", bg) })
vim.api.nvim_set_hl(0, "HulalaTreeCurrent", { fg = theme_value("highlight", fg), bold = true })
vim.api.nvim_set_hl(0, "HulalaTreeCursor", { fg = theme_value("highlight", fg) })

-- The box, the list, the search field and a picker's preview are separate
-- windows with separate backgrounds by default. They are one panel here, so
-- every one of them keeps the tree's surface, and the cursor line -- which
-- snacks points at either SnacksPickerListCursorLine or CursorLine -- is ink
-- instead of a shade.
local panel_filetypes = {
  snacks_explorer = true,
  snacks_layout_box = true,
  snacks_picker_input = true,
  snacks_picker_list = true,
  snacks_picker_preview = true,
}

local tree_winhl = table.concat({
  "Normal:HulalaTree",
  "NormalNC:HulalaTree",
  "NormalFloat:HulalaTree",
  "NormalFloatNC:HulalaTree",
  "EndOfBuffer:HulalaTree",
  "SignColumn:HulalaTree",
  "CursorLine:HulalaTreeCursor",
  "CursorLineNr:HulalaTreeCursor",
  "SnacksPickerListCursorLine:HulalaTreeCursor",
}, ",")

--- Is this window part of the tree's panel?
---@param win integer
local function tree_window(win)
  if win == nil or win == 0 or not vim.api.nvim_win_is_valid(win) then return false end
  return panel_filetypes[vim.bo[vim.api.nvim_win_get_buf(win)].filetype] == true
end

-- The file the editor column is showing. Kept here rather than taken from the
-- current buffer each time: the tree's own windows are the current buffer
-- whenever the keyboard is in the tree.
local open_file = ""

local function remember_open_file()
  if tree_window(vim.api.nvim_get_current_win()) then return end
  local buf = vim.api.nvim_get_current_buf()
  if vim.bo[buf].buftype ~= "" then return end
  local name = vim.api.nvim_buf_get_name(buf)
  if name ~= "" then open_file = name end
end

--- List buffers already watched for the next render.
local watched = {}

--- Colour the label of the file that is open, so the tree says where you are.
local function mark_open_file()
  if open_file == "" then return end
  local ok, picker = pcall(require, "snacks.picker")
  if not ok then return end
  local ns = vim.api.nvim_create_namespace("hulala-tree-current")
  local item_ns = vim.api.nvim_get_namespaces()["snacks.picker.list"]
  for _, instance in ipairs(picker.get({ source = "explorer" }) or {}) do
    local list = instance.list
    if list ~= nil and list.win ~= nil and list.win:valid() then
      local buf = list.win.buf
      vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
      if watched[buf] == nil then
        -- Re-marked after every render: the picker rewrites its lines when you
        -- scroll, search or open a folder, and a stale row would leave the ink
        -- on the wrong file.
        watched[buf] = true
        vim.api.nvim_buf_attach(buf, false, {
          on_lines = function() vim.schedule(function() pcall(mark_open_file) end) end,
          on_detach = function() watched[buf] = nil end,
        })
      end
      for item, index in instance:iter() do
        if item.file == open_file then
          local row = list:idx2row(index)
          local text = vim.api.nvim_buf_get_lines(buf, row - 1, row, false)[1]
          if text ~= nil then
            -- Only the label: the picker's own marks on this row say where the
            -- name starts and ends, after the guides and the icon.
            local from, to = 0, #text
            for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, item_ns, { row - 1, 0 }, { row - 1, -1 }, { details = true })) do
              local details = mark[4] or {}
              if details.hl_group == "SnacksPickerFile" or details.hl_group == "SnacksPickerDirectory" then
                from, to = mark[3], details.end_col or #text
                break
              end
            end
            pcall(vim.api.nvim_buf_set_extmark, buf, ns, row - 1, from, { end_col = to, hl_group = "HulalaTreeCurrent" })
          end
          break
        end
      end
    end
  end
end

--- One surface for the panel, and the ink on the open file.
local function refresh_tree()
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    if tree_window(win) and vim.wo[win].winhighlight ~= tree_winhl then vim.wo[win].winhighlight = tree_winhl end
  end
  pcall(remember_open_file)
  pcall(mark_open_file)
end

--- Restyle after the event that caused it, so snacks' own option writes lose.
local function refresh_tree_soon()
  vim.schedule(function() pcall(refresh_tree) end)
end

vim.api.nvim_create_autocmd({ "FileType", "BufWinEnter", "WinEnter", "BufEnter", "ColorScheme", "VimResized" }, {
  callback = refresh_tree_soon,
})

-- Bundled tree-sitter parsers, published next to the editor's runtime tree.
local parsers = vim.env.HULALA_NVIM_PARSERS
if parsers ~= nil and parsers ~= "" then vim.opt.rtp:prepend(parsers) end

-- Autosave keeps the files the agent reads in step with what is on screen.
-- A buffer is written a second after typing stops, and immediately when it is
-- left, the editor quits or the process suspends; entering insert mode cancels
-- a pending write. Buffers that cannot be written (unnamed, buftype, read-only)
-- are skipped in silence: the exit prompt of the client is what reports those.
--
-- The stamp is the file's mtime in nanoseconds, the same value Neovim compares
-- against to decide "this file changed on disk". Without it, writing a buffer
-- whose file the agent has just rewritten would either block on Neovim's
-- "file has been changed" confirmation (silent! does not suppress it) or, with
-- a forced write, overwrite what the agent wrote. So: never write over someone
-- else's change, say so once, and let the user decide.
local autosave_delay = 1000
local autosave_timer = {}
local autosave_stamp = {}
local autosave_reported = {}

local function autosave_mtime(name)
  local stat = vim.uv.fs_stat(name)
  if stat == nil then return -1 end
  return stat.mtime.sec * 1000000000 + stat.mtime.nsec
end

local function autosave_remember(buf)
  local name = vim.api.nvim_buf_get_name(buf)
  if name ~= "" then autosave_stamp[buf] = autosave_mtime(name) end
end

local function autosave_cancel(buf)
  local timer = autosave_timer[buf]
  if timer ~= nil then
    timer:stop()
    timer:close()
    autosave_timer[buf] = nil
  end
end

local function autosave_write(buf)
  if not vim.api.nvim_buf_is_valid(buf) or not vim.api.nvim_buf_is_loaded(buf) then return end
  local name = vim.api.nvim_buf_get_name(buf)
  if name == "" or vim.bo[buf].buftype ~= "" or vim.bo[buf].readonly or not vim.bo[buf].modified then return end
  if autosave_stamp[buf] ~= autosave_mtime(name) then
    local disk = autosave_mtime(name)
    if autosave_reported[buf] ~= disk then
      autosave_reported[buf] = disk
      vim.notify("hulala: " .. vim.fn.fnamemodify(name, ":t") .. " changed on disk, not written", vim.log.levels.WARN)
      -- The client turns this into a question, so the choice is the user's
      -- rather than a timer's. One line per new conflict; same file, same
      -- disk version is reported once.
      local file = vim.env.HULALA_NVIM_CONFLICT_FILE
      if file ~= nil and file ~= "" then
        pcall(vim.fn.writefile, { name .. "\t" .. string.format("%d", disk) }, file, "a")
      end
    end
    return
  end
  vim.api.nvim_buf_call(buf, function() vim.cmd("silent! write") end)
  autosave_remember(buf)
  autosave_reported[buf] = nil
end

local function autosave_write_all()
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do autosave_write(buf) end
end

local function autosave_defer(buf)
  autosave_cancel(buf)
  local timer = vim.uv.new_timer()
  autosave_timer[buf] = timer
  timer:start(autosave_delay, 0, function()
    vim.schedule(function()
      autosave_cancel(buf)
      autosave_write(buf)
    end)
  end)
end

vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost" }, {
  callback = function(event) autosave_remember(event.buf) end,
})
vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
  callback = function(event) autosave_defer(event.buf) end,
})
vim.api.nvim_create_autocmd("InsertEnter", {
  callback = function(event) autosave_cancel(event.buf) end,
})
vim.api.nvim_create_autocmd("BufLeave", {
  callback = function(event)
    autosave_cancel(event.buf)
    autosave_write(event.buf)
  end,
})
vim.api.nvim_create_autocmd({ "QuitPre", "FocusLost", "VimSuspend" }, {
  callback = function() autosave_write_all() end,
})

-- Plugins join 'runtimepath' one directory at a time: every bundled plugin
-- (published beside the editor) first, then every plugin the user dropped in,
-- so a user copy of the same plugin wins. Nothing is fetched at runtime.
local function prepend_plugins(root)
  if root == nil or root == "" then return end
  for _, dir in ipairs(vim.fn.glob(root .. "/*", true, true)) do
    if vim.fn.isdirectory(dir) == 1 then vim.opt.rtp:prepend(dir) end
  end
end
prepend_plugins(vim.env.HULALA_NVIM_BUNDLED_PLUGINS)
prepend_plugins(vim.env.HULALA_NVIM_PLUGIN_DIR)


-- Mermaid blocks are drawn under their fence by the same engine the conversation
-- uses. Neovim owns no renderer: the client hands over the command that runs it
-- ('HULALA_NVIM_MERMAID'), and this only decides which blocks to send, how wide
-- the drawing may be, and where the rows land. Without that command — an older
-- client, or a build started without the editor — nothing here runs.
local mermaid_argv = nil
local mermaid_setting = vim.env.HULALA_NVIM_MERMAID
if mermaid_setting ~= nil and mermaid_setting ~= "" then
  local ok, decoded = pcall(vim.json.decode, mermaid_setting)
  if ok and type(decoded) == "table" and type(decoded.argv) == "table" and #decoded.argv > 0 then
    mermaid_argv = decoded.argv
  end
end

local mermaid_enabled = true
local mermaid_namespace = vim.api.nvim_create_namespace("hulala-mermaid")
-- Drawings by window width, then by source: a redraw after a resize is cached,
-- and scrolling never spawns the renderer again.
local mermaid_cache = {}
local mermaid_timers = {}
local MERMAID_DELAY = 300

-- The marks currently on screen, per buffer: a redraw sets the new rows first
-- and removes the old ones after, in one pass, so a diagram being re-rendered
-- does not blink out while the child process runs.
local mermaid_marks = {}

local function mermaid_forget(buf)
  for _, id in ipairs(mermaid_marks[buf] or {}) do
    pcall(vim.api.nvim_buf_del_extmark, buf, mermaid_namespace, id)
  end
  mermaid_marks[buf] = nil
end

local function mermaid_clear(buf)
  if vim.api.nvim_buf_is_valid(buf) then
    mermaid_forget(buf)
    vim.api.nvim_buf_clear_namespace(buf, mermaid_namespace, 0, -1)
  end
end

-- Width the drawing may use: the text area of a window showing the buffer. A
-- buffer nobody displays has no width to draw for; its drawing is made when it
-- is shown, so a hidden buffer never spawns the renderer with a foreign width.
local function mermaid_width(buf)
  local win = vim.fn.bufwinid(buf)
  if win == -1 then return nil end
  local info = vim.fn.getwininfo(win)[1]
  local offset = info ~= nil and info.textoff or 0
  return math.max(24, vim.api.nvim_win_get_width(win) - offset)
end

-- Fenced blocks whose info string names Mermaid, with the row their art hangs
-- from: the closing fence, so the drawing sits below the block instead of
-- covering the source that is still being edited.
local function mermaid_blocks(buf)
  local ok, parser = pcall(vim.treesitter.get_parser, buf, "markdown")
  if not ok or parser == nil then return {} end
  local trees = parser:parse()
  if trees == nil or trees[1] == nil then return {} end
  local okq, query = pcall(vim.treesitter.query.parse, "markdown", table.concat({
    "(fenced_code_block",
    "  (info_string (language) @lang)",
    "  (code_fence_content) @body) @block",
  }, "\\n"))
  if not okq or query == nil then return {} end
  local ids = {}
  for index, name in ipairs(query.captures) do ids[name] = index end
  local blocks = {}
  for _, match in query:iter_matches(trees[1]:root(), buf, 0, -1, { all = true }) do
    local lang = match[ids.lang] and match[ids.lang][1]
    local body = match[ids.body] and match[ids.body][1]
    local block = match[ids.block] and match[ids.block][1]
    if lang ~= nil and body ~= nil and block ~= nil
      and vim.treesitter.get_node_text(lang, buf):lower() == "mermaid" then
      local _, _, end_row = block:range()
      blocks[#blocks + 1] = { source = vim.treesitter.get_node_text(body, buf), row = end_row }
    end
  end
  return blocks
end

local function mermaid_apply(buf, blocks)
  local fresh = {}
  for _, block in ipairs(blocks) do
    if block.art ~= nil then
      local lines = {}
      for _, row in ipairs(block.art) do lines[#lines + 1] = { { row } } end
      local ok, id = pcall(vim.api.nvim_buf_set_extmark, buf, mermaid_namespace, block.row, 0, {
        virt_lines = lines,
        virt_lines_above = false,
      })
      if ok then fresh[#fresh + 1] = id end
    end
  end
  mermaid_forget(buf)
  mermaid_marks[buf] = fresh
end

local function mermaid_render(buf)
  if mermaid_argv == nil or not mermaid_enabled or vim.system == nil then return end
  if not vim.api.nvim_buf_is_valid(buf) or vim.bo[buf].filetype ~= "markdown" then return end
  local width = mermaid_width(buf)
  if width == nil then return end
  local blocks = mermaid_blocks(buf)
  if #blocks == 0 then
    mermaid_clear(buf)
    return
  end
  -- The renderer answers a bounded batch; the rest keep their source rather than
  -- being re-sent, unsent, on every change.
  for index = #blocks, 33, -1 do blocks[index] = nil end
  local cached = mermaid_cache[width] or {}
  mermaid_cache[width] = cached
  -- Every edit of a diagram is a new source; keep the map from growing all
  -- session long. Dropping it only costs one re-render.
  local entries = 0
  for _ in pairs(cached) do entries = entries + 1 end
  if entries > 400 then
    for key in pairs(cached) do cached[key] = nil end
  end
  local sources = {}
  for _, block in ipairs(blocks) do
    if cached[block.source] ~= nil then
      block.art = cached[block.source]
    else
      sources[#sources + 1] = block.source
    end
  end
  if #sources == 0 then
    mermaid_apply(buf, blocks)
    return
  end
  vim.system(mermaid_argv, { stdin = vim.json.encode({ width = width, sources = sources }), text = true }, function(result)
    vim.schedule(function()
      if result.code ~= 0 then return end
      local ok, decoded = pcall(vim.json.decode, result.stdout or "")
      if not ok or type(decoded) ~= "table" or type(decoded.arts) ~= "table" then return end
      local index = 0
      for _, block in ipairs(blocks) do
        if block.art == nil then
          index = index + 1
          local art = decoded.arts[index]
          if art == vim.NIL then art = nil end
          block.art = art
          if art ~= nil then cached[block.source] = art end
        end
      end
      if vim.api.nvim_buf_is_valid(buf) then mermaid_apply(buf, blocks) end
    end)
  end)
end

-- One render per quiet moment: typing inside a block would otherwise spawn a
-- process per keystroke.
local function mermaid_schedule(buf)
  if mermaid_argv == nil or buf == nil or not vim.api.nvim_buf_is_valid(buf) then return end
  local timer = mermaid_timers[buf]
  if timer == nil then
    timer = vim.uv.new_timer()
    mermaid_timers[buf] = timer
  end
  timer:stop()
  timer:start(MERMAID_DELAY, 0, vim.schedule_wrap(function()
    if vim.api.nvim_buf_is_valid(buf) then mermaid_render(buf) end
  end))
end

local function mermaid_toggle()
  mermaid_enabled = not mermaid_enabled
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].filetype == "markdown" then
      if mermaid_enabled then
        mermaid_schedule(buf)
      else
        mermaid_clear(buf)
      end
    end
  end
end

if mermaid_argv ~= nil then
  vim.api.nvim_create_autocmd({ "FileType", "BufReadPost", "BufEnter", "BufWinEnter" }, {
    callback = function(args)
      if vim.bo[args.buf].filetype == "markdown" then mermaid_schedule(args.buf) end
    end,
  })
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "BufWritePost" }, {
    callback = function(args)
      if vim.bo[args.buf].filetype == "markdown" then mermaid_schedule(args.buf) end
    end,
  })
  vim.api.nvim_create_autocmd({ "VimResized", "WinResized" }, {
    callback = function() mermaid_schedule(vim.api.nvim_get_current_buf()) end,
  })
  vim.api.nvim_create_autocmd({ "BufDelete", "BufWipeout" }, {
    callback = function(args)
      local timer = mermaid_timers[args.buf]
      if timer ~= nil then
        timer:stop()
        if not timer:is_closing() then timer:close() end
        mermaid_timers[args.buf] = nil
      end
      mermaid_marks[args.buf] = nil
    end,
  })
  mermaid_schedule(vim.api.nvim_get_current_buf())
end

-- Vendored render-markdown.nvim: Markdown rendered where it is written.
--
-- Headings, code blocks, tables, checkboxes and quotes take their final shape
-- while the text stays editable; the line under the cursor keeps its raw source.
-- The plugin ships with the editor and uses the parsers the package already
-- carries, so nothing is fetched at runtime. A user copy in the plugin
-- directory wins: then the configuration is theirs to own, and the setup below
-- is skipped so it cannot overwrite their options.
local function markdown_render()
  local ok, render = pcall(require, "render-markdown")
  if not ok then return end
  local user_plugins = vim.env.HULALA_NVIM_PLUGIN_DIR
  if user_plugins ~= nil and user_plugins ~= "" then
    local first = vim.api.nvim_get_runtime_file("lua/render-markdown/init.lua", false)[1]
    if first ~= nil and vim.startswith(first, user_plugins) then return end
  end
  render.setup({
    -- No preset, and no Nerd Font assumption: the glyphs the upstream defaults
    -- put in front of headings, links and callouts are not guaranteed to be in a
    -- terminal's font, so the icons here are plain Unicode or absent.
    preset = "none",
    file_types = { "markdown" },
    -- Headings are ink plus a band behind the words: never a filled row across
    -- the window. Every level has its own hue and its own band; width = "block"
    -- ends the band where the text ends instead of painting hl_eol to the edge.
    heading = {
      sign = false,
      icons = {},
      width = "block",
      right_pad = 1,
      foregrounds = heading_inks,
      backgrounds = heading_bands,
    },
    code = {
      sign = false,
      language_icon = false,
      border = "thin",
      language_border = "▄",
      language_left = " ",
      language_right = " ",
      width = "block",
      right_pad = 1,
    },
    checkbox = { unchecked = { icon = "☐ " }, checked = { icon = "☑ " } },
    link = { enabled = false },
    -- Callout labels keep their text; only the glyph in front of it is Nerd
    -- Font, and a label without it reads the same.
    callout = {
      note = { rendered = "Note" },
      tip = { rendered = "Tip" },
      important = { rendered = "Important" },
      warning = { rendered = "Warning" },
      caution = { rendered = "Caution" },
    },
    -- Converting formulas needs utftex or latex2text, which the editor does not
    -- ship: leave the source visible instead of failing on every block.
    latex = { enabled = false },
  })
  -- One page per language with every construct this draws, for checking by eye
  -- in the editor: apps/cli/tests/fixtures/editor/markdown-sample.{zh-CN,en}.md
  vim.keymap.set("n", "<leader>um", function()
    pcall(render.buf_toggle)
    mermaid_toggle()
  end, { desc = "Markdown render" })
end
markdown_render()

-- Vendored snacks.nvim: the file tree and fuzzy pickers.
local snacks_dir = vim.env.HULALA_NVIM_SNACKS
local snacks_ready = false
if snacks_dir ~= nil and snacks_dir ~= "" then
  vim.opt.rtp:prepend(snacks_dir)
  local ok, snacks = pcall(require, "snacks")
  if ok then
    snacks.setup({
      explorer = {},
      picker = {
        -- The file tree is a sidebar of the editor column: size it as a share of
        -- the pane so it stays usable in a split instead of a fixed 40 columns.
        sources = {
          explorer = {
            -- Dotfiles are ordinary project files here: .github/, .agents/,
            -- .gitignore and friends belong in the tree, not behind a toggle.
            -- Git-ignored entries (including .git/) stay hidden.
            hidden = true,
            layout = { layout = { width = 0.38 } },
          },
        },
      },
      input = {},
      notifier = { enabled = false },
    })
    snacks_ready = true
  end
end

local function explorer(opts)
  if snacks_ready then
    Snacks.explorer(opts)
  else
    vim.cmd("Explore")
  end
end

vim.keymap.set("n", "<leader>e", function() explorer({ cwd = vim.fn.getcwd() }) end, { desc = "File tree" })
vim.keymap.set("n", "<leader>E", function() explorer() end, { desc = "File tree (current)" })
if snacks_ready then
  vim.keymap.set("n", "<leader>ff", function() Snacks.picker.files({ cwd = vim.fn.getcwd() }) end, { desc = "Find files" })
  vim.keymap.set("n", "<leader>fg", function() Snacks.picker.grep({ cwd = vim.fn.getcwd() }) end, { desc = "Grep" })
  vim.keymap.set("n", "<leader>fr", function() Snacks.picker.recent() end, { desc = "Recent files" })
end

-- The file tree's boundary, moved like the column dividers around it: the tree
-- is an ordinary split window, so its edge is a window width, and the picker's
-- own floats (the prompt line and the list) keep their offsets inside it. A
-- drag reports the pointer's column, a key moves it by a step, and both land on
-- the same clamp. The share the user leaves behind is written back to the
-- picker's source, so reopening the tree does not undo the drag, and to a small
-- state file, so it outlives the editor process.
if snacks_ready then
  local TREE_MIN = 40   -- the sidebar preset's own floor: narrower is not a tree
  local TREE_STEP = 2   -- cells one keypress moves, the same nudge as a short drag
  local TREE_STATE = vim.fn.stdpath("state") .. "/explorer-width.json"

  -- The tree currently on screen: the picker that owns a real split window.
  local function tree()
    local ok, pickers = pcall(Snacks.picker.get, { source = "explorer" })
    if not ok or pickers == nil then return nil end
    for _, picker in ipairs(pickers) do
      local layout = picker.layout
      if layout and layout.root and layout.root.win and vim.api.nvim_win_is_valid(layout.root.win) then
        return picker, layout
      end
    end
    return nil
  end

  -- Widest the tree may become: the pane on its right keeps a usable width.
  local function tree_max() return math.max(TREE_MIN, vim.o.columns - 33) end

  -- Where the boundary is, for the client: it paints the pointer shape and the
  -- hover colour for its own dividers, and this one belongs to the same family
  -- even though Neovim draws it. Reported only when it changes.
  local TREE_FILE = vim.env.HULALA_NVIM_TREE_FILE
  local reported = nil
  local function report_tree()
    if TREE_FILE == nil or TREE_FILE == "" then return end
    local _, layout = tree()
    local line = ""
    if layout ~= nil then
      local root = layout.root.win
      line = ("%d %d"):format(vim.api.nvim_win_get_position(root)[2], vim.api.nvim_win_get_width(root))
    end
    if line == reported then return end
    reported = line
    pcall(vim.fn.writefile, { line }, TREE_FILE)
  end

  -- Opening or closing the tree creates or removes its window; a resize moves the
  -- boundary. Both are seen here, after the layout has settled.
  vim.api.nvim_create_autocmd({ "WinNew", "WinClosed", "VimResized", "TabEnter" }, {
    callback = function() vim.schedule(report_tree) end,
  })


  -- Remember one width as a share of the editor column, so it restores at any size.
  local function tree_remember(columns)
    local share = columns / math.max(1, vim.o.columns)
    local config = Snacks.config.picker
    local source = config and config.sources and config.sources.explorer
    if source and source.layout and source.layout.layout then source.layout.layout.width = share end
    pcall(function()
      vim.fn.mkdir(vim.fn.stdpath("state"), "p")
      vim.fn.writefile({ vim.json.encode({ width = share }) }, TREE_STATE)
    end)
  end

  -- Move the boundary. \`remember\` is off mid-drag: one write per gesture.
  local function tree_resize(columns, remember)
    local picker, layout = tree()
    if picker == nil then return false end
    local root = layout.root.win
    local wanted = math.max(TREE_MIN, math.min(tree_max(), math.floor(columns + 0.5)))
    local current = vim.api.nvim_win_get_width(root)
    if wanted ~= current then
      local offsets = {}
      for name, widget in pairs(layout.wins) do
        if widget.opts and widget.opts.position == "float" and widget.win and vim.api.nvim_win_is_valid(widget.win) then
          offsets[name] = vim.api.nvim_win_get_width(widget.win) - current
        end
      end
      vim.api.nvim_win_set_width(root, wanted)
      -- The share, not the column count: a terminal resize then keeps the
      -- proportion the user left instead of an absolute width.
      layout.opts.layout.width = wanted / math.max(1, vim.o.columns)
      for name, offset in pairs(offsets) do
        local widget = layout.wins[name]
        widget.opts.max_width = wanted
        widget.opts.width = wanted + offset
      end
      -- A mouse mapping runs under textlock, where the picker may not redraw:
      -- schedule the reflow instead of failing in the middle of a drag.
      vim.schedule(function()
        if picker.layout == layout and not layout.closed then pcall(function() layout:update() end) end
      end)
      vim.schedule(report_tree)
    end
    if remember then tree_remember(wanted) end
    return true
  end

  -- A narrower editor column cannot keep a wide tree: the clamp is re-applied
  -- when the pane is resized (which is how Hulala's own divider drags the column).
  vim.api.nvim_create_autocmd("VimResized", {
    callback = function()
      local _, layout = tree()
      if layout == nil then return end
      tree_resize(vim.api.nvim_win_get_width(layout.root.win), false)
    end,
  })

  -- The column the boundary is drawn in: the tree's left edge plus its width.
  local function tree_edge()
    local _, layout = tree()
    if layout == nil then return nil end
    return vim.api.nvim_win_get_position(layout.root.win)[2] + vim.api.nvim_win_get_width(layout.root.win)
  end

  -- The keys this column answers are the client's column-divider chord, which it
  -- writes into the pty as Ctrl-Left / Ctrl-Right. That is the only spelling that
  -- arrives: the chord belongs to Hulala (so no window manager takes it first),
  -- and the bytes are already inside this process by the time Neovim sees them.
  -- Option-Left and Control-Left cannot be used for it: macOS owns Control-Left
  -- for switching spaces and takes it before the terminal, and what a terminal
  -- sends for Option-Left differs per terminal setting — one of them arrives as
  -- a bare Escape and closes the tree instead of moving it.
  --
  -- The key names the boundary's direction, never the tree's width: the tree sits
  -- on the left of its rule, so a boundary that moves left makes the tree
  -- narrower. That is the rule the column divider chord follows too (\`Cmd-Ctrl-[\`
  -- moves the frame's rule left) and the one Neovim's own \`<C-W><\` follows, which
  -- is why the bracket and the arrow point the same way.
  local function tree_nudge(direction)
    local _, layout = tree()
    if layout == nil then return end
    tree_resize(vim.api.nvim_win_get_width(layout.root.win) + direction * TREE_STEP, true)
  end
  vim.keymap.set("n", "<C-Left>", function() tree_nudge(-1) end, { desc = "File tree: move the boundary left" })
  vim.keymap.set("n", "<C-Right>", function() tree_nudge(1) end, { desc = "File tree: move the boundary right" })
  -- Unmodified keys, so the tree moves in any client and on any keyboard: a bare
  -- bracket or arrow is forwarded untouched by every layer between the keyboard
  -- and this process, while a modified arrow is taken by a window manager
  -- (Control-Left switches spaces on macOS) or encoded differently by each
  -- terminal. The brackets keep Neovim's habit of naming the direction, and the
  -- arrows say the same thing for anyone who would rather not leave the arrows.
  vim.keymap.set("n", "g[", function() tree_nudge(-1) end, { desc = "File tree: move the boundary left" })
  vim.keymap.set("n", "g]", function() tree_nudge(1) end, { desc = "File tree: move the boundary right" })
  vim.keymap.set("n", "<Left>", function() tree_nudge(-1) end, { desc = "File tree: move the boundary left" })
  vim.keymap.set("n", "<Right>", function() tree_nudge(1) end, { desc = "File tree: move the boundary right" })

  -- Mouse. The boundary column belongs to neither window, so the press has to be
  -- caught by the current window's mapping: the column under it is read from
  -- \`getmousepos\` instead of from which window the pointer is over. Every other
  -- press, drag and release is handed back exactly as it arrived, which is what
  -- keeps clicking, double-clicking and visual selection working.
  local drag = nil
  local function keycode(key) return vim.api.nvim_replace_termcodes(key, true, false, true) end
  local function passthrough(key) vim.api.nvim_feedkeys(keycode(key), "n", false) end
  local function on_edge()
    local edge = tree_edge()
    return edge ~= nil and vim.fn.getmousepos().screencol - 1 == edge
  end

  vim.keymap.set("n", "<LeftMouse>", function()
    if not on_edge() then return passthrough("<LeftMouse>") end
    local _, layout = tree()
    drag = { columns = vim.api.nvim_win_get_width(layout.root.win), start = vim.fn.getmousepos().screencol }
  end, { desc = "File tree: grab the boundary" })

  vim.keymap.set("n", "<LeftDrag>", function()
    if drag == nil then return passthrough("<LeftDrag>") end
    tree_resize(drag.columns + vim.fn.getmousepos().screencol - drag.start, false)
  end, { desc = "File tree: drag the boundary" })

  vim.keymap.set("n", "<LeftRelease>", function()
    if drag == nil then return passthrough("<LeftRelease>") end
    drag = nil
    local _, layout = tree()
    if layout ~= nil then tree_remember(vim.api.nvim_win_get_width(layout.root.win)) end
  end, { desc = "File tree: drop the boundary" })

  vim.schedule(report_tree)

  -- A width the user dragged last time, before the tree is first opened.
  pcall(function()
    local saved = vim.json.decode(vim.fn.readfile(TREE_STATE)[1] or "")
    local share = saved ~= nil and tonumber(saved.width) or nil
    local config = Snacks.config.picker
    local source = config and config.sources and config.sources.explorer
    if share ~= nil and share > 0 and source and source.layout and source.layout.layout then
      source.layout.layout.width = share
    end
  end)
end

vim.keymap.set("n", "<leader>w", "<cmd>write<cr>", { desc = "Write" })
vim.keymap.set("n", "<leader>q", "<cmd>quit<cr>", { desc = "Quit" })
vim.keymap.set("n", "<esc>", "<cmd>nohlsearch<cr>", { desc = "Clear search" })

-- Ctrl-S writes the buffer without leaving the current mode: <Cmd> does not open
-- the command line, so it also works while typing and keeps the cursor in place.
-- It writes the whole buffer (no visual range) and only this one, never :wall.
vim.keymap.set({ "n", "i", "v", "s", "x" }, "<C-s>", "<Cmd>write<CR>", { desc = "Write" })
`
