"use client";

import { useEffect, useState } from "react";

export function AuditPdfButton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const check = () => setVisible(Boolean(document.querySelector(".so-audit")));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  if (!visible) return null;
  return <button className="audit-pdf-button" type="button" onClick={() => window.print()}>↓ Audit als PDF</button>;
}
