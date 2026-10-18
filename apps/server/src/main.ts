import { DataError } from "@evertap/api/context";
import { ORPCError } from "@orpc/client";

import { COMMANDS, commandHelp, help } from "./cli/commands.ts";
import { syncSkill } from "./cli/skills.ts";
import { UsageError } from "./cli/terminal.ts";

// One binary: `evertap serve` is the server; every other command is the CLI talking to one.
const [typed, ...args] = process.argv.slice(2);
const name = typed === "--version" ? "version" : typed;

// Bun's codes for a certificate that no authority this machine trusts has signed, as a self-signed one.
const UNTRUSTED_CERTIFICATE = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

// `evertap list | head` closes the pipe early; that is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }
  throw error;
});

const usage = name === undefined ? undefined : commandHelp(name);
if (usage !== undefined && (args.includes("--help") || args.includes("-h"))) {
  process.stdout.write(usage);
} else if (name === "serve") {
  await import("./index.ts");
} else {
  const command = name === undefined ? undefined : COMMANDS[name];
  if (!command) {
    help();
    process.exitCode =
      name === undefined || name === "help" || name === "--help" || name === "-h" ? 0 : 1;
  } else {
    // Those two change the skill themselves.
    if (name !== "skills" && name !== "uninstall") {
      await syncSkill();
    }
    try {
      await command.run(args);
    } catch (error) {
      // A DataError is what the person can change, such as from Cloudflare during setup.
      if (error instanceof UsageError || error instanceof DataError || error instanceof ORPCError) {
        process.stderr.write(`${error.message}\n`);
      } else if (
        error instanceof TypeError &&
        "code" in error &&
        String(error.code).startsWith("ERR_PARSE_ARGS")
      ) {
        process.stderr.write(`${error.message}\nUsage: evertap ${command.usage}\n`);
      } else if (
        error instanceof TypeError &&
        "code" in error &&
        UNTRUSTED_CERTIFICATE.has(String(error.code))
      ) {
        process.stderr.write(
          "This machine does not trust evertap's certificate. Set NODE_EXTRA_CA_CERTS to the certificate that signed it, in every shell that runs evertap, or run evertap login with the http:// address\n",
        );
      } else if (error instanceof TypeError && /fetch|connect|getaddrinfo/i.test(error.message)) {
        process.stderr.write("Cannot reach evertap. Check the address, or run evertap status\n");
      } else {
        throw error;
      }
      process.exitCode = 1;
    }
  }
}
