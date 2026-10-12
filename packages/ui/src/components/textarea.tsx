import { cx } from "@evertap/ui/lib/cx";
import * as React from "react";

import styles from "./textarea.module.css";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cx(styles.textarea, className)} {...props} />;
}

export { Textarea };
