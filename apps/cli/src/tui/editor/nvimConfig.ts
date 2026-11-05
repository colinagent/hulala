/**
 * The Neovim config Hulala ships with the editor column.
 *
 * Kept as strings rather than loose files so the single-file client bundle
 * carries them. Two files land in `<data>/config/editor/nvim/`:
 *
 * - `hulala.lua` is {@link NVIM_BASE_LUA}: the settings the client owns (theme,
 *   autosave, the file tree, the pickers). It is rewritten whenever its content
 *   changes, because a fix that never reaches an existing installation is not a
 *   fix. The client also loads it through `nvim --cmd` before Neovim reads any
 *   user config, so installations whose `init.lua` was written by an older
 *   client still get it.
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

vim.keymap.set("n", "<leader>w", "<cmd>write<cr>", { desc = "Write" })
vim.keymap.set("n", "<leader>q", "<cmd>quit<cr>", { desc = "Quit" })
vim.keymap.set("n", "<esc>", "<cmd>nohlsearch<cr>", { desc = "Clear search" })

-- Ctrl-S writes the buffer without leaving the current mode: <Cmd> does not open
-- the command line, so it also works while typing and keeps the cursor in place.
-- It writes the whole buffer (no visual range) and only this one, never :wall.
vim.keymap.set({ "n", "i", "v", "s", "x" }, "<C-s>", "<Cmd>write<CR>", { desc = "Write" })
`
