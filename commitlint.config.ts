import type { UserConfig } from "@commitlint/types";

// Conventional commits with a mandatory scope, e.g. `feat(web): add the database list`.
const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-empty": [2, "never"],
    "scope-enum": [2, "always", ["web", "server", "site", "api", "ui", "config", "deps", "repo"]],
    "subject-case": [0],
    // GitHub cuts a longer first line off with an ellipsis.
    "header-max-length": [2, "always", 72],
  },
};

export default config;
