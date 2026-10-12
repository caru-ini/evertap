import { DATABASE_ENGINES, STORAGE_ENGINES, type ResourceEngine } from "@evertap/api/rules";

export const RESOURCE_GROUPS = [
  { id: "databases", label: "Databases", engines: DATABASE_ENGINES },
  { id: "object-storage", label: "Object storage", engines: STORAGE_ENGINES },
];

export const ENGINE_INFO = {
  postgresql: {
    label: "PostgreSQL",
    summary: "SQL database",
    placeholder: "myapp_dev",
    nameHint:
      "A label only: the URL uses a generated user. Start with a lowercase letter; use lowercase letters, digits, _ and -. Up to 63 characters.",
  },
  mysql: {
    label: "MySQL",
    summary: "SQL database",
    placeholder: "myapp_dev",
    nameHint:
      "A label only: the URL uses a generated user. Start with a lowercase letter; use lowercase letters, digits, _ and -. Up to 63 characters.",
  },
  redis: {
    label: "Redis",
    summary: "Key-value",
    placeholder: "myapp_cache",
    nameHint:
      "Start with a lowercase letter; use lowercase letters, digits, _ and -. Up to 63 characters.",
  },
  garage: {
    label: "Garage",
    summary: "S3 compatible",
    placeholder: "myapp-assets",
    nameHint:
      "Use 3–63 lowercase letters, digits or hyphens. Start and end with a letter or digit.",
  },
} satisfies Record<
  ResourceEngine,
  {
    label: string;
    summary: string;
    placeholder: string;
    nameHint: string;
  }
>;
