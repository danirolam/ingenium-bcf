import type { ReactNode } from "react";
import type { PageId } from "../App";
import { Sidebar } from "./Sidebar";

export function Layout({
  page,
  setPage,
  onExit,
  children,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  onExit?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} onExit={onExit} />
      <main className="main">{children}</main>
    </div>
  );
}
