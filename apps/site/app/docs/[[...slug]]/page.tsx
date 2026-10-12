import { Card, type CardProps } from "fumadocs-ui/components/card";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
} from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";

import { CloudflareCreates } from "../../../components/diagrams/cloudflare-creates.tsx";
import { ConnectPath } from "../../../components/diagrams/connect-path.tsx";
import { DockerNeeds } from "../../../components/diagrams/docker-needs.tsx";
import { InstallPaths } from "../../../components/diagrams/install-paths.tsx";
import { InstallScript } from "../../../components/diagrams/install-script.tsx";
import { Listeners } from "../../../components/diagrams/listeners.tsx";
import { LocalAddresses } from "../../../components/diagrams/local-addresses.tsx";
import { Outbound } from "../../../components/diagrams/outbound.tsx";
import { Precedence } from "../../../components/diagrams/precedence.tsx";
import { ProxyPath } from "../../../components/diagrams/proxy-path.tsx";
import { Services } from "../../../components/diagrams/services.tsx";
import { SetupChoices } from "../../../components/diagrams/setup-choices.tsx";
import { SignedLinks } from "../../../components/diagrams/signed-links.tsx";
import { TunnelPath } from "../../../components/diagrams/tunnel-path.tsx";
import { Wsl } from "../../../components/diagrams/wsl.tsx";
import { Trademarks } from "../../../components/trademarks.tsx";
import { iconByName } from "../../../lib/icons.tsx";
import { GITHUB_URL } from "../../../lib/layout.tsx";
import { source } from "../../../lib/source.ts";

import styles from "./page.module.css";

type Props = { params: Promise<{ slug?: string[] }> };

export default async function Page({ params }: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Mdx = page.data.body;
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description && <DocsDescription>{page.data.description}</DocsDescription>}
      <DocsBody>
        <Mdx components={componentsFor(page.path)} />
      </DocsBody>
      {/* The site is built from develop, where changes to the docs go too. */}
      <EditOnGitHub href={`${GITHUB_URL}/blob/develop/docs/${page.path}`} />
      <div className={styles.notice}>
        <Trademarks />
      </div>
    </DocsPage>
  );
}

/** What a page in docs/ can use; it imports nothing itself. */
function componentsFor(from: string) {
  const resolve = resolverFrom(from);
  const Link = defaultMdxComponents.a;
  return {
    ...defaultMdxComponents,
    a: function DocLink({ href, ...props }: ComponentProps<"a">) {
      return <Link href={href && resolve(href)} {...props} />;
    },
    Card: function DocCard({ icon, href, ...props }: Omit<CardProps, "icon"> & { icon?: string }) {
      const Icon = icon ? iconByName(icon) : undefined;
      return <Card icon={Icon && <Icon />} href={href && resolve(href)} {...props} />;
    },
    Steps,
    Step,
    Tabs,
    Tab,
    CloudflareCreates,
    ConnectPath,
    DockerNeeds,
    InstallPaths,
    InstallScript,
    Listeners,
    LocalAddresses,
    Outbound,
    Precedence,
    ProxyPath,
    Services,
    SetupChoices,
    SignedLinks,
    TunnelPath,
    Wsl,
  };
}

// Pages link to each other as `modes.mdx#tailscale` so the links also work on GitHub; Fumadocs
// resolves only paths that start with `./` or `../`. A link to a missing page fails the build.
function resolverFrom(from: string) {
  const dir = from.split("/").slice(0, -1).join("/");
  return (href: string) => {
    if (!/^(\.\.\/)*[\w/-]+\.mdx(#|$)/.test(href)) return href;
    const target = source.getPageByHref(href.startsWith("../") ? href : `./${href}`, { dir });
    if (!target) throw new Error(`${from} links to ${href}, which is not a page in docs/`);
    return target.hash ? `${target.page.url}#${target.hash}` : target.page.url;
  };
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
