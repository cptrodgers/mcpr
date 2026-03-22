import {
  createRootRoute,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import { WidgetListPage } from "./pages/widget-list";
import { WidgetDebugPage } from "./pages/widget-debug";

const rootRoute = createRootRoute({
  component: () => (
    <div className="dark min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WidgetListPage,
});

const widgetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/widgets/$name",
  component: WidgetDebugPage,
});

export const routeTree = rootRoute.addChildren([indexRoute, widgetRoute]);
