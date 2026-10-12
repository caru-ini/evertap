import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cx } from "@evertap/ui/lib/cx";

import styles from "./switch.module.css";

const SIZES = {
  default: styles.sizeDefault,
  sm: styles.sizeSm,
};

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: keyof typeof SIZES;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={(state) =>
        cx(
          styles.switch,
          SIZES[size],
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={styles.thumb} />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
