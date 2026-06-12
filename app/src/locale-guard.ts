// MUST be imported FIRST (before any charting/uPlot code).
//
// uPlot evaluates `new Intl.NumberFormat(navigator.language)` at MODULE-LOAD time.
// Some browser configurations — notably Firefox with privacy.resistFingerprinting,
// certain locale/extension setups, or an embedded webview — report an invalid or
// blank `navigator.language`. That makes `new Intl.NumberFormat(<bad tag>)` throw a
// RangeError ("invalid language tag: …"), which happens during the module graph eval
// and BLANKS THE ENTIRE APP (white screen, no error visible to the user).
//
// Guard it two ways: (1) repair navigator.language if it's not a usable BCP-47 tag,
// and (2) wrap Intl.NumberFormat so a bad locale anywhere falls back to "en-US"
// instead of throwing. Valid locales are completely unaffected.

const FALLBACK = "en-US";

function localeUsable(tag: unknown): boolean {
  if (typeof tag !== "string" || tag.length === 0) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.NumberFormat(tag);
    return true;
  } catch {
    return false;
  }
}

// (1) Repair navigator.language for any code that reads it directly.
if (typeof navigator !== "undefined" && !localeUsable(navigator.language)) {
  try {
    Object.defineProperty(navigator, "language", { value: FALLBACK, configurable: true });
  } catch {
    /* not overridable in this engine — the Intl wrapper below still covers it */
  }
}

// (2) Belt-and-braces: never let an invalid locale arg throw. Preserve the API
// (prototype + statics) so `instanceof` and `supportedLocalesOf` keep working.
const OrigNumberFormat = Intl.NumberFormat;
function SafeNumberFormat(
  this: unknown,
  locales?: string | string[],
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  try {
    return new (OrigNumberFormat as unknown as new (l?: unknown, o?: unknown) => Intl.NumberFormat)(locales, options);
  } catch {
    return new (OrigNumberFormat as unknown as new (l?: unknown, o?: unknown) => Intl.NumberFormat)(FALLBACK, options);
  }
}
SafeNumberFormat.prototype = OrigNumberFormat.prototype;
SafeNumberFormat.supportedLocalesOf = OrigNumberFormat.supportedLocalesOf.bind(OrigNumberFormat);
(Intl as { NumberFormat: unknown }).NumberFormat = SafeNumberFormat;

export {};
