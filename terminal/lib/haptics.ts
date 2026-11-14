// a short buzz for actions and outcomes. android/chrome vibrates; ios 18+ safari has no vibrate, but toggling a
// hidden <input type="checkbox" switch> fires the system haptic. silent no-op anywhere else, never throws.
// opt out with localStorage bh:haptics = "off"
export type Haptic = "tap" | "select" | "success" | "warning" | "error";

const PATTERN: Record<Haptic, number | number[]> = {
  tap: 8,
  select: 12,
  success: [10, 40, 18],
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};
// ios gives one tick per toggle, so outcomes become a few spaced ticks
const TICKS: Record<Haptic, number> = { tap: 1, select: 1, success: 2, warning: 2, error: 3 };

let enabled = true;
try {
  if (typeof localStorage !== "undefined" && localStorage.getItem("bh:haptics") === "off") enabled = false;
} catch {}

export const setHaptics = (on: boolean) => {
  enabled = on;
  try {
    localStorage.setItem("bh:haptics", on ? "on" : "off");
  } catch {}
};

let label: HTMLLabelElement | null = null;
function iosSwitch() {
  if (label?.isConnected) return label;
  const l = document.createElement("label");
  l.setAttribute("aria-hidden", "true");
  l.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  l.appendChild(input);
  document.body.appendChild(l);
  label = l;
  return l;
}

export function haptic(kind: Haptic = "tap") {
  if (!enabled || typeof window === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERN[kind]);
      return;
    }
    // only ios has the switch haptic; elsewhere clicking a hidden label does nothing useful
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) return;
    const l = iosSwitch();
    for (let i = 0; i < TICKS[kind]; i++) setTimeout(() => l.click(), i * 70);
  } catch {}
}
