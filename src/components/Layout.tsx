import type { ReactNode } from "react";
import type { PageId } from "../App";
import { WorkflowNav } from "./WorkflowNav";

export function Layout({
  page,
  params,
  setPage,
  onExit,
  children,
}: {
  page: PageId;
  params: Record<string, string>;
  setPage: (p: PageId) => void;
  onExit?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <WorkflowNav page={page} params={params} setPage={setPage} onExit={onExit} />
      <main className="shell-main">{children}</main>
    </div>
  );
}
