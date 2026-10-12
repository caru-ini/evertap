import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cx } from "@evertap/ui/lib/cx";

import styles from "./button.module.css";

const VARIANTS = {
  default: styles.primary,
  outline: styles.outline,
  secondary: styles.secondary,
  ghost: styles.ghost,
  destructive: styles.destructive,
  link: styles.link,
};

const SIZES = {
  default: styles.sizeDefault,
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  lg: styles.sizeLg,
  icon: styles.sizeIcon,
  "icon-xs": styles.sizeIconXs,
  "icon-sm": styles.sizeIconSm,
  "icon-lg": styles.sizeIconLg,
};

type ButtonVariants = {
  variant?: keyof typeof VARIANTS | null;
  size?: keyof typeof SIZES | null;
  className?: string;
};

/** The button's classes, for a link or other element that should look like one. */
function buttonVariants({ variant, size, className }: ButtonVariants = {}) {
  return cx(styles.button, VARIANTS[variant ?? "default"], SIZES[size ?? "default"], className);
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & Omit<ButtonVariants, "className">) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={(state) =>
        buttonVariants({
          variant,
          size,
          className: typeof className === "function" ? className(state) : className,
        })
      }
      {...props}
    />
  );
}

export { Button, buttonVariants };
