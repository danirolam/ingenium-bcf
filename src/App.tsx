import { useCallback, useState } from "react";
import { Layout } from "./components/Layout";
import { Toast } from "./components/Toast";
import { BillMonitor } from "./pages/BillMonitor";
import { ClientImpactAnalysisPage } from "./pages/ClientImpactAnalysis";
import { ClientLawScanner } from "./pages/ClientLawScanner";
import { DeltaWorkspace } from "./pages/DeltaWorkspace";

export type PageId = "monitor" | "delta" | "scanner" | "impact";

export type Nav = {
  go: (page: PageId, params?: Record<string, string>) => void;
  page: PageId;
  params: Record<string, string>;
  toast: (msg: string) => void;
};

export default function App() {
  const [page, setPage] = useState<PageId>("monitor");
  const [params, setParams] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const go = useCallback((p: PageId, ps: Record<string, string> = {}) => {
    setPage(p);
    setParams(ps);
  }, []);

  const setPageOnly = useCallback((p: PageId) => {
    setPage(p);
    setParams({});
  }, []);

  const nav: Nav = { go, page, params, toast: setToastMsg };

  let view;
  if (page === "monitor") view = <BillMonitor nav={nav} />;
  else if (page === "delta") view = <DeltaWorkspace nav={nav} />;
  else if (page === "scanner") view = <ClientLawScanner nav={nav} />;
  else view = <ClientImpactAnalysisPage nav={nav} />;

  return (
    <Layout page={page} setPage={setPageOnly}>
      {view}
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
    </Layout>
  );
}
