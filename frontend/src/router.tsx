import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/components/AppShell";

const ProblemListPage = lazy(() =>
  import("@/pages/ProblemListPage").then((m) => ({ default: m.ProblemListPage })),
);
const ProblemDetailPage = lazy(() =>
  import("@/pages/ProblemDetailPage").then((m) => ({ default: m.ProblemDetailPage })),
);
const ReviewDuePage = lazy(() =>
  import("@/pages/ReviewDuePage").then((m) => ({ default: m.ReviewDuePage })),
);
const HistoryPage = lazy(() =>
  import("@/pages/HistoryPage").then((m) => ({ default: m.HistoryPage })),
);
const HistoryListPage = lazy(() =>
  import("@/pages/HistoryListPage").then((m) => ({ default: m.HistoryListPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

function Loading() {
  return (
    <div className="route-loading inline-wait">
      <span className="inline-wait-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>正在加载……</span>
    </div>
  );
}

function withSuspense(node: React.ReactNode) {
  return <Suspense fallback={<Loading />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: withSuspense(<ProblemListPage />) },
      { path: "problem/:id", element: withSuspense(<ProblemDetailPage />) },
      { path: "review", element: withSuspense(<ReviewDuePage />) },
      { path: "history", element: withSuspense(<HistoryListPage />) },
      { path: "history/:problemId", element: withSuspense(<HistoryPage />) },
      { path: "settings", element: withSuspense(<SettingsPage />) },
    ],
  },
]);
