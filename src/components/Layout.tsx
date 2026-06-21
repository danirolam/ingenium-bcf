import type { ReactNode } from "react";
import type { PageId } from "../App";
import { WorkflowNav } from "./WorkflowNav";

export function Layout({
  page,
  params,
  go,
  onExit,
  children,
}: {
  page: PageId;
  params: Record<string, string>;
  go: (p: PageId, params?: Record<string, string>) => void;
  onExit?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <WorkflowNav page={page} params={params} go={go} onExit={onExit} />
      <main className="shell-main">{children}</main>
    </div>
  );
}
