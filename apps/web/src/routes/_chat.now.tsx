import { createFileRoute } from "@tanstack/react-router";

import { NowPage } from "../components/now/NowPage";

export const Route = createFileRoute("/_chat/now")({
  component: NowPage,
});
