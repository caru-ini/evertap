import { formatConnection } from "@evertap/api/connections";
import type { Database, ObjectStorage } from "@evertap/api/schemas";
import { describe, expect, it } from "vitest";

import {
  getConnectionFormats,
  getConnectionSecrets,
  maskConnectionValue,
} from "./resource-connections.ts";

const base = {
  id: "test-resource",
  name: "test_app",
  description: "",
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: "2026-09-19T00:00:00.000Z",
};

const database = (engine: Database["engine"]): Database => ({
  ...base,
  kind: "database",
  engine,
  version: "1",
  connectionUrl:
    engine === "redis"
      ? "redis://test_app:fake-password@evertap.local:6379/0"
      : `${engine === "postgresql" ? "postgres" : "mysql"}://test_app:fake-password@evertap.local:${engine === "postgresql" ? "6432" : "3306"}/test_app`,
  extensions: [],
});

const storage = (engine: ObjectStorage["engine"]): ObjectStorage => ({
  ...base,
  kind: "object-storage",
  engine,
  name: "test-assets",
  endpoint: "http://evertap.local:3900",
  region: "us-east-1",
  accessKeyId: "fake-access-key",
  secretAccessKey: "fake-secret-key",
  reachableAnywhere: false,
  publicEndpoint: null,
});

describe("connection formats", () => {
  it.each([
    ["postgresql", "psql", "DATABASE_URL"],
    ["mysql", "mysql", "DATABASE_URL"],
    ["redis", "redis-cli", "REDIS_URL"],
  ] as const)("uses the %s client and environment variable", (engine, command, variable) => {
    const resource = database(engine);
    expect(getConnectionFormats(resource).map((format) => format.label)).toEqual([
      "URI",
      ".env",
      command,
    ]);
    expect(formatConnection(resource, "uri")).toBe(resource.connectionUrl);
    expect(formatConnection(resource, "env")).toBe(`${variable}=${resource.connectionUrl}`);
    expect(formatConnection(resource, "cli")).toMatch(new RegExp(`^${command} `));
  });

  it("connects MySQL over TCP and prompts for the password", () => {
    const resource = database("mysql");
    resource.connectionUrl = "mysql://test%2Duser:fake-password@evertap.local:3307/test%2Dapp";
    expect(formatConnection(resource, "cli")).toBe(
      "mysql --protocol=TCP --host='evertap.local' --port='3307' --user='test-user' --password --database='test-app'",
    );
    expect(formatConnection(resource, "cli")).not.toContain("fake-password");
  });

  it.each(["garage"] as const)(
    "includes the %s endpoint, bucket, credentials, and checksum settings",
    (engine) => {
      const resource = storage(engine);
      expect(getConnectionFormats(resource).map((format) => format.label)).toEqual([
        "Credentials",
        ".env",
        "AWS CLI",
      ]);
      expect(formatConnection(resource, "env")).toBe(
        [
          `AWS_ENDPOINT_URL_S3=${resource.endpoint}`,
          `AWS_REGION=${resource.region}`,
          "AWS_ACCESS_KEY_ID=fake-access-key",
          "AWS_SECRET_ACCESS_KEY=fake-secret-key",
          "S3_BUCKET=test-assets",
          "S3_FORCE_PATH_STYLE=true",
          "AWS_REQUEST_CHECKSUM_CALCULATION=when_required",
          "AWS_RESPONSE_CHECKSUM_VALIDATION=when_required",
        ].join("\n"),
      );
      expect(formatConnection(resource, "cli")).toContain(`--endpoint-url '${resource.endpoint}'`);
      expect(formatConnection(resource, "cli")).toContain(`--region '${resource.region}'`);
      expect(formatConnection(resource, "cli")).toContain("s3 ls 's3://test-assets/'");
    },
  );

  it("keeps shell metacharacters literal in PostgreSQL and Redis commands", () => {
    for (const engine of ["postgresql", "redis"] as const) {
      const resource = database(engine);
      resource.connectionUrl = resource.connectionUrl.replace(
        "fake-password",
        "fake'$(printf injected)`printf injected`",
      );
      const command = formatConnection(resource, "cli");
      expect(command).toContain("fake'\\''$(printf injected)`printf injected`");
      expect(command).toBe(
        engine === "postgresql"
          ? "psql 'postgres://test_app:fake'\\''$(printf injected)`printf injected`@evertap.local:6432/test_app'"
          : "redis-cli -u 'redis://test_app:fake'\\''$(printf injected)`printf injected`@evertap.local:6379/0'",
      );
    }
  });

  it("adds the public endpoint for signing links, leaving the endpoint and the command as they are", () => {
    const resource = {
      ...storage("garage"),
      reachableAnywhere: true,
      publicEndpoint: "https://s3.example.com",
    };
    expect(formatConnection(resource, "env").split("\n").slice(0, 2)).toEqual([
      "AWS_ENDPOINT_URL_S3=http://evertap.local:3900",
      "S3_PUBLIC_ENDPOINT=https://s3.example.com",
    ]);
    expect(formatConnection(resource, "cli")).toContain(
      "--endpoint-url 'http://evertap.local:3900'",
    );
  });

  it("keeps storage credentials literal in the copied AWS command", () => {
    const resource = storage("garage");
    resource.secretAccessKey = "fake'$(printf injected)`printf injected`";
    expect(formatConnection(resource, "cli")).toBe(
      [
        "AWS_ACCESS_KEY_ID='fake-access-key' \\",
        "AWS_SECRET_ACCESS_KEY='fake'\\''$(printf injected)`printf injected`' \\",
        "aws --endpoint-url 'http://evertap.local:3900' --region 'us-east-1' s3 ls 's3://test-assets/'",
      ].join("\n"),
    );
  });
});

describe("connection masking", () => {
  it("masks URL passwords even without a username", () => {
    expect(maskConnectionValue("redis://:fake-password@evertap.local:6379/0")).toBe(
      "redis://:********@evertap.local:6379/0",
    );
  });

  it("masks encoded database passwords in every displayed format", () => {
    const resource = database("postgresql");
    resource.connectionUrl =
      "postgres://test_app:fake%40password%3Awith%2Fsymbols@evertap.local:6432/test_app";
    const secrets = getConnectionSecrets(resource);
    expect(secrets).toContain("fake@password:with/symbols");
    for (const { id } of getConnectionFormats(resource)) {
      const value = formatConnection(resource, id);
      const masked = maskConnectionValue(value, secrets);
      expect(masked).not.toContain("fake");
      expect(masked).toContain("********");
      expect(value).toContain("fake%40password%3Awith%2Fsymbols");
    }
  });

  it("masks storage secrets in credentials, environment, and escaped CLI previews", () => {
    const resource = storage("garage");
    resource.secretAccessKey = "fake'$(printf injected)";
    const secrets = getConnectionSecrets(resource);
    expect(maskConnectionValue(resource.secretAccessKey, secrets)).toBe("********");
    for (const { id } of getConnectionFormats(resource)) {
      const value = formatConnection(resource, id);
      const masked = maskConnectionValue(value, secrets);
      expect(masked).not.toContain("printf injected");
      expect(masked).toContain("********");
      expect(masked).toContain(resource.accessKeyId);
      expect(value).toContain("printf injected");
    }
  });

  it("keeps public endpoints and values without passwords unchanged", () => {
    expect(maskConnectionValue("http://evertap.local:9000", [""])).toBe(
      "http://evertap.local:9000",
    );
    expect(maskConnectionValue("redis://evertap.local:6379/0")).toBe(
      "redis://evertap.local:6379/0",
    );
  });
});
