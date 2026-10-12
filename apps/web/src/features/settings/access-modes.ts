import {
  type AccessChoice,
  DATABASE_ADDRESS,
  DATABASE_HOST,
  WILDCARDS,
  accessChoice,
} from "@evertap/api/rules";
import {
  type NetworkGuide,
  type SavedSettings,
  type Settings,
  publicUrlSchema,
  storageUrlSchema,
} from "@evertap/api/schemas";
import {
  CloudIcon,
  type Icon,
  LaptopIcon,
  ShareNetworkIcon,
  WifiHighIcon,
} from "@phosphor-icons/react";

/** Each choice's icon, beside its name wherever the UI shows it. */
export const CHOICE_ICONS: Record<AccessChoice, Icon> = {
  local: LaptopIcon,
  network: WifiHighIcon,
  cloudflare: CloudIcon,
  proxy: ShareNetworkIcon,
};

/** What switching to a choice changes, for the step that confirms it. */
export const CHOICE_OUTCOMES: Record<AccessChoice, string> = {
  local: `Only this computer opens evertap, and apps on it connect to ${DATABASE_HOST} directly.`,
  network:
    "Phones and laptops on this network open evertap there. Apps on other machines connect with evertap connect.",
  cloudflare:
    "Browsers open evertap there from anywhere. Apps on other machines connect with evertap connect.",
  proxy:
    "Your proxy or tunnel passes browsers on to evertap, and Settings then shows what to paste into it. Apps on other machines connect with evertap connect.",
};

/** Docker's bridge address, where Docker has one. */
export const dockerOf = ({ listenChoices }: NetworkGuide) =>
  listenChoices.find(({ use }) => use === "docker")?.address ?? null;

/** Which choice the settings in force are; null until evertap is set up. */
export const choiceOf = (settings: Settings, guide: NetworkGuide) =>
  accessChoice(settings.mode.value, settings.listenHost.value, dockerOf(guide));

/** Who can reach what listens at `host`. */
export const listenReach = (host: string, { listenChoices }: NetworkGuide) => {
  if (WILDCARDS.has(host)) return "Every network this machine is on";
  if (listenChoices.some(({ use, address }) => use === "docker" && address === host)) {
    return "This machine and what runs in Docker on it";
  }
  if (host === DATABASE_ADDRESS) return `This machine only, as ${DATABASE_HOST}`;
  if (host === "::1" || host.startsWith("127.")) return "This machine only";
  return "That address of this machine only";
};

/** The address typed, as evertap keeps it; nothing for empty, or why it is not one. */
const readAddress = (
  typed: string,
  schema: typeof publicUrlSchema,
): { url: string | null } | { error: string } => {
  if (typed.trim() === "") {
    return { url: null };
  }
  const parsed = schema.safeParse(typed.trim());
  return parsed.success
    ? { url: parsed.data }
    : { error: parsed.error.issues[0]?.message ?? "Give an address such as https://example.com" };
};

/** What the person gave for a choice, as Change access holds it. */
export type ChoiceFields = {
  /** Where the UI listens for devices on the network. */
  lanHost: string;
  /** Where it listens for the person's own proxy or tunnel. */
  place: string;
  /** Another address for devices on the network, the proxy's, and buckets', as typed. */
  lanUrl: string;
  proxyUrl: string;
  storage: string;
  /** Whether `EVERTAP_PUBLIC_URL` sets the address, which is then left out. */
  urlFixed: boolean;
};

/** The settings a choice saves, or which address is wrong and why. */
export const savedFor = (
  choice: Exclude<AccessChoice, "cloudflare">,
  fields: ChoiceFields,
): { saved: SavedSettings } | { field: "url" | "storage"; message: string } => {
  if (choice === "local") {
    return { saved: { mode: "local" } };
  }
  const buckets = readAddress(fields.storage, storageUrlSchema);
  if ("error" in buckets) {
    return { field: "storage", message: buckets.error };
  }
  const typed = fields.urlFixed
    ? { url: null }
    : readAddress(choice === "network" ? fields.lanUrl : fields.proxyUrl, publicUrlSchema);
  if ("error" in typed) {
    return { field: "url", message: typed.error };
  }
  // Behind a proxy, only the person knows the address browsers use.
  if (choice === "proxy" && !fields.urlFixed && typed.url === null) {
    return { field: "url", message: "Give the address your proxy or tunnel serves evertap at" };
  }
  return {
    saved: {
      mode: "network",
      listenHost: choice === "network" ? fields.lanHost : fields.place,
      publicUrl: typed.url,
      storageUrl: buckets.url,
    },
  };
};
