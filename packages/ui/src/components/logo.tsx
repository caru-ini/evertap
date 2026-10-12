import { cx } from "@evertap/ui/lib/cx";

import styles from "./logo.module.css";

const STREAMS = ["#E88A8A", "#F2D46B", "#7FAFD6"];

// Exported where declared: the site's RSC build attaches CSS only to components exported this way.
/** The evertap mark (the favicon's square) and name, shared by the app and the site. */
export function Logo({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cx(styles.logo, className)} {...props}>
      <LogoMark className={styles.mark} />
      <span className={styles.name}>evertap</span>
    </span>
  );
}

/** The square mark alone, sized by the caller. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 31 31" aria-hidden="true">
      <rect width="31" height="31" rx="6" fill="#D9D9D9" />
      <rect x="6" y="5" width="20" height="11" fill="#767676" />
      {STREAMS.map((color, i) => (
        <rect key={color} x={10 + i * 4} y="16" width="4" height="10" fill={color} />
      ))}
    </svg>
  );
}
