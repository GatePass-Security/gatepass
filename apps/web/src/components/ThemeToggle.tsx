"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { IconButton } from "./ui/Button";

export function ThemeToggle() {
  // Dark is the product's canonical appearance; the pre-paint script in
  // layout.tsx has already applied it, so this only mirrors what is on <html>.
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable (private mode) — the class still applies this session */
    }
  }

  return (
    <IconButton label={dark ? "Switch to light theme" : "Switch to dark theme"} size="sm" onClick={toggle}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </IconButton>
  );
}
