import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const provisionInvestigatorUrl = new URL(
  "../src/lib/provision-investigator.ts",
  import.meta.url,
).href;
const databaseUrl = new URL("../src/lib/db/index.ts", import.meta.url).href;

describe("provisioning process cleanup", () => {
  it("exits promptly after explicitly closing its database pool", () => {
    const password = `Exit-test-${randomUUID()}`;
    const childSource = `
      import { createInvestigatorAccount } from ${JSON.stringify(provisionInvestigatorUrl)};
      import { closeDatabasePool } from ${JSON.stringify(databaseUrl)};

      try {
        await createInvestigatorAccount({
          email: process.env.PROVISION_EXIT_EMAIL,
          name: "Process Exit Test",
          password: process.env.PROVISION_EXIT_PASSWORD,
          confirmInvestigator: true,
        });
      } finally {
        await closeDatabasePool();
      }
    `;

    const result = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        childSource,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PROVISION_EXIT_EMAIL: `process-exit-${randomUUID()}@example.com`,
          PROVISION_EXIT_PASSWORD: password,
        },
        timeout: 10_000,
      },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(output).not.toContain(password);
  }, 15_000);
});
