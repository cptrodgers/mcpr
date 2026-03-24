import { createRootRoute, createRoute } from "@tanstack/react-router";
import { StudioLayout } from "./pages/studio-layout";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <StudioLayout />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
});

export const routeTree = rootRoute.addChildren([indexRoute]);
