import { DocsBody, DocsPage, DocsTitle, EditOnGitHub } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";

import { Trademarks } from "../../../components/trademarks.tsx";
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
      <DocsBody>
        <Mdx components={{ ...defaultMdxComponents, a: linkFrom(page.path) }} />
      </DocsBody>
      {/* The site is built from develop, where changes to the docs go too. */}
      <EditOnGitHub href={`${GITHUB_URL}/blob/develop/docs/${page.path}`} />
      <div className={styles.notice}>
        <Trademarks />
      </div>
    </DocsPage>
  );
}

// Pages link to each other as `modes.md#tailscale` so the links also work on GitHub; Fumadocs
// resolves only paths that start with `./`. A link to a missing page fails the build.
function linkFrom(from: string) {
  const Link = defaultMdxComponents.a;
  const dir = from.split("/").slice(0, -1).join("/");
  return function DocLink({ href, ...props }: ComponentProps<"a">) {
    if (!href || !/^[\w-]+\.md(#|$)/.test(href)) return <Link href={href} {...props} />;
    const target = source.getPageByHref(`./${href}`, { dir });
    if (!target) throw new Error(`${from} links to ${href}, which is not a page in docs/`);
    const url = target.hash ? `${target.page.url}#${target.hash}` : target.page.url;
    return <Link href={url} {...props} />;
  };
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return { title: page.data.title };
}
