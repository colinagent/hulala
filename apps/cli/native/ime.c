/*
 * ime — read or switch the macOS keyboard input source.
 *
 * The TUI switches to an English layout whenever a surface reads keys as
 * commands (Neovim's normal mode, the rail, a selector) and gives the user's own
 * source back when a surface reads keys as text. The client cannot remember what
 * that source was without asking, so a mutating call reports both ends of the
 * switch on stdout, one id per line:
 *
 *   line 1  the source in force before the call (empty when unreadable)
 *   line 2  the source in force after it
 *
 * Exit codes tell the caller what the two lines mean:
 *
 *   0   switched
 *   10  already on the requested source; nothing was changed
 *   3   the wanted source is not available (for `--english`: no layout at all)
 *   4   the source was found but macOS refused the switch
 *
 *   ime                     print the current input source id
 *   ime <source-id>         select that source
 *   ime --english           select the first available English layout
 *   ime --english-id        print that layout's id without switching
 *
 * "Available English layout" is asked of macOS rather than named here: the
 * first keyboard layout (`kTISTypeKeyboardLayout`, which by construction reads
 * keys as characters instead of composing them) whose declared languages
 * include English, then any keyboard layout at all — a machine whose only
 * layouts are non-English still gets a source the command surfaces can read.
 * No vendor or layout id is hard-coded, so third-party and non-Apple English
 * layouts work the same way.
 *
 * Input source ids come from macOS: `com.apple.keylayout.ABC` is the plain
 * English layout, `com.apple.inputmethod.SCIM.ITABC` Apple's Pinyin, and any
 * third-party input method reports its own bundle-scoped mode id.
 */
#include <Carbon/Carbon.h>
#include <stdio.h>
#include <string.h>

#define IME_EXIT_USAGE 64
#define IME_EXIT_NO_SOURCE 1
#define IME_EXIT_UNKNOWN_SOURCE 3
#define IME_EXIT_SELECT_FAILED 4
#define IME_EXIT_ALREADY 10

static CFStringRef copy_prop(TISInputSourceRef source, CFStringRef key) {
  CFTypeRef value = TISGetInputSourceProperty(source, key);
  if (value == NULL || CFGetTypeID(value) != CFStringGetTypeID()) return NULL;
  return CFStringCreateCopy(kCFAllocatorDefault, (CFStringRef)value);
}

static int to_c_string(CFStringRef string, char *buffer, size_t size) {
  if (string == NULL) return 0;
  return CFStringGetCString(string, buffer, (CFIndex)size, kCFStringEncodingUTF8) ? 1 : 0;
}

/** The id of the source that currently owns keyboard input. */
static char *current_id(void) {
  static char buffer[256];
  buffer[0] = '\0';
  TISInputSourceRef source = TISCopyCurrentKeyboardInputSource();
  if (source == NULL) return buffer;
  CFStringRef id = copy_prop(source, kTISPropertyInputSourceID);
  CFRelease(source);
  to_c_string(id, buffer, sizeof(buffer));
  if (id != NULL) CFRelease(id);
  return buffer;
}

/**
 * Every source macOS would let us select right now.
 *
 * `TISCreateInputSourceList` is asked for enabled and select-capable sources
 * only: selecting a disabled one fails, and a source that is not select-capable
 * (an input method bundle rather than one of its modes) is not a target.
 */
static CFArrayRef selectable_sources(void) {
  CFMutableDictionaryRef filter = CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionaryAddValue(filter, kTISPropertyInputSourceIsEnabled, kCFBooleanTrue);
  CFDictionaryAddValue(filter, kTISPropertyInputSourceIsSelectCapable, kCFBooleanTrue);
  CFArrayRef sources = TISCreateInputSourceList(filter, false);
  CFRelease(filter);
  return sources;
}

/** The source in `sources` whose id is `wanted`, or NULL. */
static TISInputSourceRef find_by_id(CFArrayRef sources, const char *wanted) {
  for (CFIndex index = 0; index < CFArrayGetCount(sources); index++) {
    TISInputSourceRef source = (TISInputSourceRef)CFArrayGetValueAtIndex(sources, index);
    CFStringRef id = copy_prop(source, kTISPropertyInputSourceID);
    char buffer[256];
    int ok = to_c_string(id, buffer, sizeof(buffer));
    if (id != NULL) CFRelease(id);
    if (ok && strcmp(buffer, wanted) == 0) return source;
  }
  return NULL;
}

/** Whether a source is a keyboard layout, which never composes keystrokes. */
static int is_layout(TISInputSourceRef source) {
  CFStringRef type = copy_prop(source, kTISPropertyInputSourceType);
  int layout = 0;
  if (type != NULL) {
    layout = CFEqual(type, kTISTypeKeyboardLayout);
    CFRelease(type);
  }
  return layout;
}

/** Whether a source declares English among the languages macOS reports for it. */
static int is_english(TISInputSourceRef source) {
  CFTypeRef value = TISGetInputSourceProperty(source, kTISPropertyInputSourceLanguages);
  if (value == NULL || CFGetTypeID(value) != CFArrayGetTypeID()) return 0;
  CFArrayRef languages = (CFArrayRef)value;
  for (CFIndex index = 0; index < CFArrayGetCount(languages); index++) {
    CFTypeRef language = CFArrayGetValueAtIndex(languages, index);
    if (language == NULL || CFGetTypeID(language) != CFStringGetTypeID()) continue;
    if (CFStringHasPrefix((CFStringRef)language, CFSTR("en"))) return 1;
  }
  return 0;
}

/**
 * The layout to switch to: an English one when the machine has it, otherwise the
 * first layout there is.
 *
 * Correctness only needs "a keyboard layout": one never composes a keystroke, so
 * a command surface reads every key. English is the preference because a
 * non-English layout moves punctuation and `y`/`z` around, which is worse than
 * useless for a vim motion. Nothing here names a vendor, a bundle or a layout.
 */
static TISInputSourceRef find_english(CFArrayRef sources) {
  TISInputSourceRef first = NULL;
  for (CFIndex index = 0; index < CFArrayGetCount(sources); index++) {
    TISInputSourceRef source = (TISInputSourceRef)CFArrayGetValueAtIndex(sources, index);
    if (!is_layout(source)) continue;
    if (is_english(source)) return source;
    if (first == NULL) first = source;
  }
  return first;
}

/** Id of a source, or an empty string when it has none. */
static void source_id(TISInputSourceRef source, char *buffer, size_t size) {
  buffer[0] = '\0';
  if (source == NULL) return;
  CFStringRef id = copy_prop(source, kTISPropertyInputSourceID);
  to_c_string(id, buffer, size);
  if (id != NULL) CFRelease(id);
}

/**
 * Print both ends of a switch and select `target`.
 *
 * The previous id is printed before the switch so a caller that spawns us once
 * still learns what to give back afterwards. A source that is already in force
 * is reported as such instead of being selected again, which is how a window
 * that is already in English costs one call and no change.
 */
static int switch_to(TISInputSourceRef target) {
  char previous[256];
  char wanted[256];
  snprintf(previous, sizeof(previous), "%s", current_id());
  source_id(target, wanted, sizeof(wanted));
  printf("%s\n%s\n", previous, wanted);
  fflush(stdout);
  if (strcmp(previous, wanted) == 0) return IME_EXIT_ALREADY;
  return TISSelectInputSource(target) == noErr ? 0 : IME_EXIT_SELECT_FAILED;
}

/** `ime` — print the source that owns keyboard input. */
static int print_current(void) {
  const char *id = current_id();
  if (id[0] == '\0') return IME_EXIT_NO_SOURCE;
  printf("%s\n", id);
  return 0;
}

/** `ime <source-id>` — select one source by id. */
static int select_by_id(const char *wanted) {
  CFArrayRef sources = selectable_sources();
  if (sources == NULL) return IME_EXIT_NO_SOURCE;
  TISInputSourceRef source = find_by_id(sources, wanted);
  int status = source == NULL ? IME_EXIT_UNKNOWN_SOURCE : switch_to(source);
  CFRelease(sources);
  return status;
}

/** `ime --english-id` — print the layout `--english` would select, without switching. */
static int print_english(void) {
  CFArrayRef sources = selectable_sources();
  if (sources == NULL) return IME_EXIT_NO_SOURCE;
  TISInputSourceRef source = find_english(sources);
  int status = IME_EXIT_UNKNOWN_SOURCE;
  if (source != NULL) {
    char id[256];
    source_id(source, id, sizeof(id));
    if (id[0] != '\0') {
      printf("%s\n", id);
      status = 0;
    }
  }
  CFRelease(sources);
  return status;
}

/** `ime --english` — select the first available English layout. */
static int select_english(void) {
  CFArrayRef sources = selectable_sources();
  if (sources == NULL) return IME_EXIT_NO_SOURCE;
  TISInputSourceRef source = find_english(sources);
  int status = source == NULL ? IME_EXIT_UNKNOWN_SOURCE : switch_to(source);
  CFRelease(sources);
  return status;
}

int main(int argc, char **argv) {
  if (argc == 1) return print_current();
  if (argc == 2 && strcmp(argv[1], "--english") == 0) return select_english();
  if (argc == 2 && strcmp(argv[1], "--english-id") == 0) return print_english();
  if (argc == 2) return select_by_id(argv[1]);
  fprintf(stderr, "usage: %s [--english | input-source-id]\n", argv[0]);
  return IME_EXIT_USAGE;
}
