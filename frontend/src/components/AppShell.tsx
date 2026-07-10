import { Link, NavLink, Outlet } from "react-router-dom";

import { useReviewsDue } from "@/hooks/useReviewsDue";
import { useTheme } from "@/hooks/useTheme";

import { ToastHost } from "./StatusToast";
import styles from "./AppShell.module.css";

export function AppShell() {
  useTheme();
  const { data: due } = useReviewsDue();
  const dueCount = due?.items.length ?? 0;
  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <Link to="/" className={styles.brand}>
          <span className={styles.brandMark}>EasyCode</span>
        </Link>
        <nav className={styles.navLinks}>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
          >
            题库
          </NavLink>
          <NavLink
            to="/review"
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
          >
            待复习
            {dueCount > 0 && <span className={styles.dueBadge}>{dueCount}</span>}
          </NavLink>
          <NavLink
            to="/history"
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
          >
            历史
          </NavLink>
        </nav>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            isActive ? `${styles.settingsLink} ${styles.navLinkActive}` : styles.settingsLink
          }
        >
          设置
        </NavLink>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}
