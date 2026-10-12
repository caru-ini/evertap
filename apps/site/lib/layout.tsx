import { Logo } from "@evertap/ui/components/logo";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const SITE_URL = "https://evertap.dev";
export const GITHUB_URL = "https://github.com/caru-ini/evertap";

export const baseOptions: BaseLayoutProps = {
  nav: { title: <Logo /> },
  githubUrl: GITHUB_URL,
  links: [{ text: "Docs", url: "/docs/install", active: "nested-url", on: "nav" }],
};
