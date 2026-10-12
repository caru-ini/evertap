import type { Resource } from "./schemas.ts";

export type ConnectionFormat = "uri" | "env" | "cli" | "credentials";

// Single quotes also protect shell expansions in pasted connection values.
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Format connection details for an application or a POSIX command shell. */
export const formatConnection = (resource: Resource, format: ConnectionFormat): string => {
  if (resource.kind === "object-storage") {
    if (format === "cli") {
      return [
        `AWS_ACCESS_KEY_ID=${shellQuote(resource.accessKeyId)} \\`,
        `AWS_SECRET_ACCESS_KEY=${shellQuote(resource.secretAccessKey)} \\`,
        `aws --endpoint-url ${shellQuote(resource.endpoint)} --region ${shellQuote(resource.region)} s3 ls ${shellQuote(`s3://${resource.name}/`)}`,
      ].join("\n");
    }

    return [
      `AWS_ENDPOINT_URL_S3=${resource.endpoint}`,
      // For signing links only; no SDK reads it, so the app's other calls keep to the endpoint.
      ...(resource.publicEndpoint === null
        ? []
        : [`S3_PUBLIC_ENDPOINT=${resource.publicEndpoint}`]),
      `AWS_REGION=${resource.region}`,
      `AWS_ACCESS_KEY_ID=${resource.accessKeyId}`,
      `AWS_SECRET_ACCESS_KEY=${resource.secretAccessKey}`,
      `S3_BUCKET=${resource.name}`,
      // No AWS SDK reads a path-style variable, but bucket.<endpoint host> never resolves.
      "S3_FORCE_PATH_STYLE=true",
      // The SDKs' default checksums fail on Garage for presigned PUTs and some uploads.
      "AWS_REQUEST_CHECKSUM_CALCULATION=when_required",
      "AWS_RESPONSE_CHECKSUM_VALIDATION=when_required",
    ].join("\n");
  }

  if (format === "env") {
    return `${resource.engine === "redis" ? "REDIS_URL" : "DATABASE_URL"}=${resource.connectionUrl}`;
  }
  if (format === "cli") {
    if (resource.engine === "mysql") {
      const url = new URL(resource.connectionUrl);
      return [
        "mysql --protocol=TCP",
        `--host=${shellQuote(url.hostname)}`,
        `--port=${shellQuote(url.port || "3306")}`,
        `--user=${shellQuote(decodeURIComponent(url.username))}`,
        "--password",
        `--database=${shellQuote(decodeURIComponent(url.pathname.slice(1)))}`,
      ].join(" ");
    }
    return `${resource.engine === "redis" ? "redis-cli -u" : "psql"} ${shellQuote(resource.connectionUrl)}`;
  }
  return resource.connectionUrl;
};
