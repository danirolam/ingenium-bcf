import { useCallback, useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { Toast } from "./components/Toast";
import { Landing } from "./pages/Landing";
import { Overview } from "./pages/Overview";
import { BillMonitor } from "./pages/BillMonitor";
import { BillDetail } from "./pages/BillDetail";
import { ClientImpactAnalysisPage } from "./pages/ClientImpactAnalysis";
import { ClientLawScanner } from "./pages/ClientLawScanner";
import { DeltaWorkspace } from "./pages/DeltaWorkspace";
import { buildPath, parsePath, type Route } from "./lib/routes";

export type PageId =
  | "overview"
  | "monitor"
  | "bill"
  | "delta"
  | "scanner"
  | "impact";

export type Nav = {
  go: (page: PageId, params?: Record<string, string>) => void;
  page: PageId;
  params: Record<string, string>;
  toast: (msg: string) => void;
};

function currentRoute(): Route {
  if (typeof window === "undefined") {
    return { surface: "landing", page: "overview", params: {} };
  }
  return parsePath(window.location.pathname, window.location.search);
}

export default function App() {
  // The URL is the single source of truth for navigation. `go` pushes a new
  // history entry; the popstate listener re-reads the URL when the user hits
  // the browser back/forward arrows — so the arrows step through the workflow.
  const [route, setRoute] = useState<Route>(() => currentRoute());
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const { surface, page, params } = route;

  // Every page (and entering the app) opens at the top — never inherit the
  // previous view's scroll position.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, surface]);

  // Push a new URL and sync state. pushState doesn't fire popstate, so we
  // update `route` ourselves; back/forward go through the listener above.
  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setRoute(currentRoute());
  }, []);

  const enterApp = useCallback(() => {
    navigate(buildPath("overview"));
  }, [navigate]);

  const exitToLanding = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const go = useCallback(
    (p: PageId, ps: Record<string, string> = {}) => {
      navigate(buildPath(p, ps));
    },
    [navigate],
  );

  const setPageOnly = useCallback(
    (p: PageId) => {
      navigate(buildPath(p));
    },
    [navigate],
  );

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
