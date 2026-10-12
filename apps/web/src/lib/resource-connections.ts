import type { ConnectionFormat } from "@evertap/api/connections";
import type { Resource } from "@evertap/api/schemas";

/** Copy formats supported by the selected resource's client tools. */
export const getConnectionFormats = (
  resource: Resource,
): { id: ConnectionFormat; label: string; copyLabel: string }[] => {
  if (resource.kind === "object-storage") {
    return [
      { id: "credentials", label: "Credentials", copyLabel: "Copy connection details" },
      { id: "env", label: ".env", copyLabel: "Copy .env values" },
      { id: "cli", label: "AWS CLI", copyLabel: "Copy AWS CLI command" },
    ];
  }

  const command = { postgresql: "psql", mysql: "mysql", redis: "redis-cli" }[resource.engine];
  return [
    { id: "uri", label: "URI", copyLabel: "Copy connection URL" },
    { id: "env", label: ".env", copyLabel: "Copy .env line" },
    { id: "cli", label: command, copyLabel: `Copy ${command} command` },
  ];
};

/** Secret variants used in the URI, credential fields, and command previews. */
export const getConnectionSecrets = (resource: Resource): string[] => {
  if (resource.kind === "object-storage") {
    return [resource.secretAccessKey];
  }
  const password = new URL(resource.connectionUrl).password;
  return [password, decodeURIComponent(password)];
};

/** Hide both explicit secrets and embedded URI passwords without changing copied values. */
export const maskConnectionValue = (value: string, secrets: readonly string[] = []): string => {
  const passwords = Array.from(
    value.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^:/\s]*:([^@\s]+)@/gi),
    (match) => match[1] ?? "",
  );
  const variants = [...new Set([...secrets, ...passwords])]
    .filter(Boolean)
    .flatMap((secret) => [secret, secret.replaceAll("'", "'\\''")])
    .toSorted((left, right) => right.length - left.length);
  return variants.reduce((masked, secret) => masked.replaceAll(secret, "********"), value);
};
