"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./navigation-progress.module.css";

export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setActive(false);
    if (timer.current) window.clearTimeout(timer.current);
  }, [pathname]);

  useEffect(() => {
    const begin = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setActive(true), 120);
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
        begin();
      } catch { return; }
    };
    const pop = () => begin();
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return <div className={`${styles.track} ${active ? styles.active : ""}`} aria-hidden="true"><span /></div>;
}
