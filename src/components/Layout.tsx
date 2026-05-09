import type { ReactNode } from "react";
import type { PageId } from "../App";
import { Sidebar } from "./Sidebar";
import { DynamicIslandTOC } from "./ui/dynamic-island-toc";

const PAGE_CRUMB: Record<PageId, string> = {
  monitor: "Bill Monitor",
  delta: "Delta Workspace",
  scanner: "Client-Law Scanner",
  impact: "Client Impact Analysis",
};

export function Layout({
  page,
  setPage,
  children,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  children: ReactNode;
}) {
  const crumb = PAGE_CRUMB[page] ?? "Workspace";
  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} />
      <main className="main">
        <div
          style={{
            height: 44,
            background: "var(--bg)",
            borderBottom: "1px solid var(--border)",
            padding: "0 36px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            color: "var(--ink-3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--ink-4)", letterSpacing: "0.005em" }}>
              Injenium
            </span>
            <span style={{ color: "var(--ink-4)" }}>/</span>
            <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>
              {crumb}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-4)",
              }}
            >
              ⌘K
            </span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--ok)",
                boxShadow: "0 0 0 3px rgba(52, 211, 153, 0.15)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-4)",
                letterSpacing: "0.04em",
              }}
            >
              LIVE
            </span>
          </div>
        </div>
        <DynamicIslandTOC>{children}</DynamicIslandTOC>
      </main>
    </div>
  );
}
