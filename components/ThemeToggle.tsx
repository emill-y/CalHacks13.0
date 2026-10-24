"use client";

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("tb-theme", root.dataset.theme);
    } catch {}
  }
  return (
    <button onClick={toggle} aria-label="Toggle dark mode" className="rounded-full px-2 py-1.5 hover:bg-soft">
      ◐
    </button>
  );
}
