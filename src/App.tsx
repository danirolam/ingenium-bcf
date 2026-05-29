import { useCallback, useState } from "react";
import { Layout } from "./components/Layout";
import { Toast } from "./components/Toast";
import { Landing } from "./pages/Landing";
import { Overview } from "./pages/Overview";
import { BillMonitor } from "./pages/BillMonitor";
import { BillDetail } from "./pages/BillDetail";
import { ClientImpactAnalysisPage } from "./pages/ClientImpactAnalysis";
import { ClientLawScanner } from "./pages/ClientLawScanner";
import { DeltaWorkspace } from "./pages/DeltaWorkspace";

export type PageId =
  | "overview"
  | "monitor"
  | "bill"
  | "delta"
  | "scanner"
  | "impact";
type Surface = "landing" | "app";

export type Nav = {
  go: (page: PageId, params?: Record<string, string>) => void;
  page: PageId;
  params: Record<string, string>;
  toast: (msg: string) => void;
};

export default function App() {
  // Read initial surface from URL hash so deep links work (#/app etc.)
  const [surface, setSurface] = useState<Surface>(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#/app")
      ? "app"
      : "landing",
  );
  const [page, setPage] = useState<PageId>("overview");
  const [params, setParams] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const enterApp = useCallback(() => {
    setSurface("app");
    setPage("overview");
    setParams({});
    if (typeof window !== "undefined") window.location.hash = "#/app";
  }, []);

  const exitToLanding = useCallback(() => {
    setSurface("landing");
    if (typeof window !== "undefined") {
      // Clear the hash so the landing matches a fresh visit
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const go = useCallback((p: PageId, ps: Record<string, string> = {}) => {
    setPage(p);
    setParams(ps);
  }, []);

  const setPageOnly = useCallback((p: PageId) => {
    setPage(p);
    setParams({});
  }, []);

  if (surface === "landing") {
    return <Landing onLaunch={enterApp} />;
  }

  const nav: Nav = { go, page, params, toast: setToastMsg };

  let view;
  if (page === "overview") view = <Overview nav={nav} />;
  else if (page === "monitor") view = <BillMonitor nav={nav} />;
  else if (page === "bill") view = <BillDetail nav={nav} />;
  else if (page === "delta") view = <DeltaWorkspace nav={nav} />;
  else if (page === "scanner") view = <ClientLawScanner nav={nav} />;
  else view = <ClientImpactAnalysisPage nav={nav} />;

  return (
    <Layout page={page} setPage={setPageOnly} onExit={exitToLanding}>
      {view}
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
    </Layout>
  );
}
