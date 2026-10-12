import { Button } from "@evertap/ui/components/button";
import { Input } from "@evertap/ui/components/input";
import { Textarea } from "@evertap/ui/components/textarea";
import { cx } from "@evertap/ui/lib/cx";
import * as React from "react";

import styles from "./input-group.module.css";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cx(styles.inputGroup, className)}
      {...props}
    />
  );
}

const ALIGNS = {
  "inline-start": styles.inlineStart,
  "inline-end": styles.inlineEnd,
  "block-start": styles.blockStart,
  "block-end": styles.blockEnd,
};

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & { align?: keyof typeof ALIGNS | null }) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cx(styles.addon, ALIGNS[align ?? "inline-start"], className)}
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest("button")) {
          return;
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      {...props}
    />
  );
}

const BUTTON_SIZES = {
  xs: styles.buttonXs,
  sm: undefined,
  "icon-xs": styles.buttonIconXs,
  "icon-sm": styles.buttonIconSm,
};

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> & {
  size?: keyof typeof BUTTON_SIZES | null;
  type?: "button" | "submit" | "reset";
}) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={(state) =>
        cx(
          styles.button,
          BUTTON_SIZES[size ?? "xs"],
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cx(styles.text, className)} {...props} />;
}

function InputGroupInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <Input data-slot="input-group-control" className={cx(styles.control, className)} {...props} />
  );
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cx(styles.control, styles.textarea, className)}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
