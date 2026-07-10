import { useCallback, useEffect, useState } from "react";

import type { Theme } from "@/styles/tokens";

const KEY = "easycode:theme";

function getInitial(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(KEY) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitial);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }, []);

  return { theme, setTheme, toggle };
}
