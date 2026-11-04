/*
 * ime — read or switch the macOS keyboard input source.
 *
 * The TUI switches to the English layout when the editor column takes focus and
 * puts the previous source back when focus returns to the composer. macOS only
 * exposes that through the Text Input Source API, so the release ships this
 * helper next to `nvim` in `bin/`.
 *
 *   ime                     print the current input source id
 *   ime <source-id>         select that source (ids macOS does not offer are
 *                           ignored; the call still exits 0 only when it ran)
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

static CFStringRef copy_prop(TISInputSourceRef source, CFStringRef key) {
  CFTypeRef value = TISGetInputSourceProperty(source, key);
  if (value == NULL || CFGetTypeID(value) != CFStringGetTypeID()) return NULL;
  return CFStringCreateCopy(kCFAllocatorDefault, (CFStringRef)value);
}

static int to_c_string(CFStringRef string, char *buffer, size_t size) {
  if (string == NULL) return 0;
  return CFStringGetCString(string, buffer, (CFIndex)size, kCFStringEncodingUTF8) ? 1 : 0;
}

/** Print the id of the source that currently owns keyboard input. */
static int print_current(void) {
  TISInputSourceRef source = TISCopyCurrentKeyboardInputSource();
  if (source == NULL) return IME_EXIT_NO_SOURCE;
  CFStringRef id = copy_prop(source, kTISPropertyInputSourceID);
  CFRelease(source);
  char buffer[256];
  int ok = to_c_string(id, buffer, sizeof(buffer));
  if (id != NULL) CFRelease(id);
  if (!ok) return IME_EXIT_NO_SOURCE;
  printf("%s\n", buffer);
  return 0;
}

/** Select the enabled, select-capable source whose id is `wanted`. */
static int select_source(const char *wanted) {
  CFMutableDictionaryRef filter = CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionaryAddValue(filter, kTISPropertyInputSourceIsEnabled, kCFBooleanTrue);
  CFDictionaryAddValue(filter, kTISPropertyInputSourceIsSelectCapable, kCFBooleanTrue);
  CFArrayRef sources = TISCreateInputSourceList(filter, false);
  CFRelease(filter);
  if (sources == NULL) return IME_EXIT_NO_SOURCE;
  int status = IME_EXIT_UNKNOWN_SOURCE;
  for (CFIndex index = 0; index < CFArrayGetCount(sources); index++) {
    TISInputSourceRef source = (TISInputSourceRef)CFArrayGetValueAtIndex(sources, index);
    CFStringRef id = copy_prop(source, kTISPropertyInputSourceID);
    char buffer[256];
    int ok = to_c_string(id, buffer, sizeof(buffer));
    if (id != NULL) CFRelease(id);
    if (!ok || strcmp(buffer, wanted) != 0) continue;
    status = TISSelectInputSource(source) == noErr ? 0 : IME_EXIT_SELECT_FAILED;
    break;
  }
  CFRelease(sources);
  return status;
}

int main(int argc, char **argv) {
  if (argc == 1) return print_current();
  if (argc == 2) return select_source(argv[1]);
  fprintf(stderr, "usage: %s [input-source-id]\n", argv[0]);
  return IME_EXIT_USAGE;
}
