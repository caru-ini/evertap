import { cx } from "@evertap/ui/lib/cx";

import styles from "./kbd.module.css";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd data-slot="kbd" className={cx(styles.kbd, className)} {...props} />;
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <kbd data-slot="kbd-group" className={cx(styles.group, className)} {...props} />;
}

export { Kbd, KbdGroup };
