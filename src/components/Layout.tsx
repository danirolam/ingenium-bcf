import type { ReactNode } from "react";
import type { PageId } from "../App";
import { WorkflowNav } from "./WorkflowNav";

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
    <div className="shell">
      <WorkflowNav page={page} setPage={setPage} onExit={onExit} />
      <main className="shell-main">{children}</main>
    </div>
  );
}
