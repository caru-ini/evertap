import { cx } from "@evertap/ui/lib/cx";
import type { ComponentType, SVGProps } from "react";
import {
  Apple,
  AppleDark,
  Cloudflare,
  Docker,
  GithubDark,
  GithubLight,
  Linux,
  Windows,
} from "svgl-react";

import styles from "./brand.module.css";

type Mark = ComponentType<SVGProps<SVGSVGElement>>;

// A one-colour mark comes in two, black and white; both render and the theme hides one.
const BRANDS: Record<BrandName, [Mark] | [light: Mark, dark: Mark]> = {
  apple: [Apple, AppleDark],
  cloudflare: [Cloudflare],
  docker: [Docker],
  github: [GithubLight, GithubDark],
  linux: [Linux],
  windows: [Windows],
};

// These ship a width and height but no viewBox, so sized smaller they show only their top-left corner.
const VIEW_BOXES: Partial<Record<BrandName, string>> = {
  cloudflare: "0 0 256 116",
  github: "0 0 256 250",
  windows: "0 0 88 88",
};

export type BrandName = "apple" | "cloudflare" | "docker" | "github" | "linux" | "windows";

/** A product's own mark in its colours, 1em square unless the parent sizes its svg. */
export function Brand({ name, className }: { name: BrandName; className?: string }) {
  const [Light, Dark] = BRANDS[name];
  // Only when missing: an undefined one would erase the viewBox the others ship.
  const viewBox = VIEW_BOXES[name] ? { viewBox: VIEW_BOXES[name] } : {};
  if (!Dark) {
    return (
      <Light
        aria-hidden
        {...viewBox}
        className={cx(styles.brand, name === "linux" && styles.tux, className)}
      />
    );
  }
  return (
    <>
      <Light aria-hidden {...viewBox} className={cx(styles.brand, styles.onLight, className)} />
      <Dark aria-hidden {...viewBox} className={cx(styles.brand, styles.onDark, className)} />
    </>
  );
}
