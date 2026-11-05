/**
 * The Neovim config Hulala writes on first use.
 *
 * Kept as a string rather than a second file on disk so the single-file client
 * bundle carries it: `ensureEditorConfig()` writes it to
 * `<data>/config/editor/nvim/init.lua`, which Neovim then reads as its own
 * `$XDG_CONFIG_HOME/nvim/init.lua`. Writing it once (never overwriting) means a
 * user can edit it and keep those edits across upgrades.
 *
 * Everything configurable arrives through the environment so the config holds no
 * hardcoded palette: `HULALA_NVIM_THEME` is the JSON from
 * {@link editorThemeFromTerminal} and `HULALA_NVIM_SNACKS` is the vendored
 * plugin directory. Without the plugin the file tree falls back to netrw.
 *
 * @module hulala-cli/tui/editor/nvimConfig
 */

/** Lua source of Hulala's editor config. */
export const NVIM_INIT_LUA = `-- Hulala editor config. Regenerated only when missing, so edits here persist.
-- Written by the Hulala terminal client; the theme follows your terminal.

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

-- The file tree and the pickers mark the row under the keyboard with ink, not
-- with a filled band: a background here would be a second surface inside a
-- column that is meant to read as one, and this client reserves background
-- blocks for panels, never for selection.
vim.api.nvim_set_hl(0, "HulalaTree", { fg = fg, bg = theme_value("pmenu", bg) })
vim.api.nvim_set_hl(0, "HulalaTreeCursor", { bg = theme_value("pmenuSelected", bg) })

local function tree_window(win)
  local filetype = vim.bo[vim.api.nvim_win_get_buf(win)].filetype
  if not filetype:match("^snacks_picker") and filetype ~= "snacks_explorer" then return end
  -- One surface for the whole column, whatever the tree is: the float it opens
  -- as, and the window it becomes next to an opened file. The selected entry is
  -- the only row allowed a different background.
  vim.wo[win].winhighlight = "Normal:HulalaTree,NormalFloat:HulalaTree,EndOfBuffer:HulalaTree,SignColumn:HulalaTree,CursorLine:HulalaTreeCursor,SnacksPickerCursorLine:HulalaTreeCursor"
end

vim.api.nvim_create_autocmd({ "FileType", "BufWinEnter", "WinEnter" }, {
  callback = function(event) tree_window(event.win) end,
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

/** Content of the generated config, for tests and first-use writes. */
export const NVIM_CONFIG_MARKER = 'Hulala editor config'
