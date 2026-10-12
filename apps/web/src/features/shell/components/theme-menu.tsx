import { Button } from "@evertap/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@evertap/ui/components/dropdown-menu";
import { cx } from "@evertap/ui/lib/cx";
import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";

import { setTheme, useTheme } from "@/lib/theme.ts";

import styles from "./theme-menu.module.css";

const THEMES = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
] as const;

export const ThemeMenu = ({ className }: { className?: string }) => {
  const theme = useTheme();
  const current = THEMES.find((option) => option.value === theme) ?? THEMES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            title="Theme"
            className={cx(styles.trigger, className)}
          />
        }
      >
        <current.Icon aria-hidden />
        <span className="sr-only">Theme: {current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={styles.menu}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              const next = THEMES.find((option) => option.value === value);
              if (next) setTheme(next.value);
            }}
          >
            {THEMES.map(({ value, label, Icon }) => (
              <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                <Icon aria-hidden />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
