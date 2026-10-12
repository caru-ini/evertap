import { cx } from "@evertap/ui/lib/cx";
import * as React from "react";

import styles from "./label.module.css";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cx(styles.label, className)} {...props} />;
}

export { Label };
