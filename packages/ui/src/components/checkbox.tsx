import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cx } from "@evertap/ui/lib/cx";
import { CheckIcon } from "@phosphor-icons/react";

import styles from "./checkbox.module.css";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={(state) =>
        cx(styles.checkbox, typeof className === "function" ? className(state) : className)
      }
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className={styles.indicator}>
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
