import { useState } from "react";

import { Button } from "@/components/tailgrids/core/button";

/**
 * Light or dark, remembered per machine.
 *
 * Lives in `app/` rather than `ui/` because it reaches for the document and
 * local storage directly — it is the one control that is about the shell, not
 * about the data.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(!dark);
    try {
      localStorage.setItem("tablinum-theme", next);
    } catch {
      // Private window or blocked site data: the choice then applies to this
      // session only, which is no reason to swallow the click.
    }
  }

  return (
    <Button variant="ghost" size="sm" onPress={toggle} className="w-full justify-start text-ink">
      {dark ? "Switch to light" : "Switch to dark"}
    </Button>
  );
}
