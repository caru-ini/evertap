import type { AccessChoice } from "@evertap/api/rules";

import { CHOICE_ICONS } from "../access-modes.ts";

/** A choice's icon, as the rows that offer it show it. */
export const ChoiceIcon = ({ choice, className }: { choice: AccessChoice; className?: string }) => {
  const Icon = CHOICE_ICONS[choice];
  return <Icon aria-hidden className={className} />;
};
