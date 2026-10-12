import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cx } from "@evertap/ui/lib/cx";

import styles from "./separator.module.css";

function Separator({ className, orientation = "horizontal", ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={(state) =>
        cx(styles.separator, typeof className === "function" ? className(state) : className)
      }
      {...props}
    />
  );
}

export { Separator };
