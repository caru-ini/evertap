import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cx } from "@evertap/ui/lib/cx";

import styles from "./collapsible.module.css";

function Collapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger(props: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

/** Animates its height open and shut, so what sits below slides instead of jumping. */
function CollapsiblePanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={(state) =>
        cx(styles.panel, typeof className === "function" ? className(state) : className)
      }
      {...props}
    />
  );
}

export { Collapsible, CollapsiblePanel, CollapsibleTrigger };
