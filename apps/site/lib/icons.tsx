import {
  ArrowsLeftRightIcon,
  CodeIcon,
  DotsNineIcon,
  DownloadSimpleIcon,
  GitBranchIcon,
  InfoIcon,
  LaptopIcon,
  PlugIcon,
  ShareNetworkIcon,
  ShieldCheckIcon,
  SignpostIcon,
  SlidersHorizontalIcon,
  TerminalWindowIcon,
  WifiHighIcon,
} from "@phosphor-icons/react/ssr";
import type { ComponentType } from "react";

import { Brand, type BrandName } from "../components/brand.tsx";

type Icon = ComponentType<{ className?: string }>;

const brand = (name: BrandName): Icon =>
  function BrandIcon({ className }) {
    return <Brand name={name} className={className} />;
  };

/** Icons docs pages name in frontmatter and `<Card icon>`: products in their colours, the rest Phosphor. */
const ICONS: Record<string, Icon> = {
  Apple: brand("apple"),
  Cloudflare: brand("cloudflare"),
  Docker: brand("docker"),
  Linux: brand("linux"),
  Windows: brand("windows"),
  ArrowsLeftRight: ArrowsLeftRightIcon,
  Code: CodeIcon,
  DotsNine: DotsNineIcon,
  DownloadSimple: DownloadSimpleIcon,
  GitBranch: GitBranchIcon,
  Info: InfoIcon,
  Laptop: LaptopIcon,
  Plug: PlugIcon,
  ShareNetwork: ShareNetworkIcon,
  ShieldCheck: ShieldCheckIcon,
  Signpost: SignpostIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
  TerminalWindow: TerminalWindowIcon,
  WifiHigh: WifiHighIcon,
};

/** An unknown name fails the build instead of showing no icon. */
export function iconByName(name: string): Icon {
  const icon = Object.hasOwn(ICONS, name) ? ICONS[name] : undefined;
  if (!icon) throw new Error(`No icon named ${name} in lib/icons.tsx`);
  return icon;
}
