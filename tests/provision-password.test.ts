import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { user } from "../src/lib/db/auth-schema";
import { db } from "../src/lib/db";
import { createInvestigatorAccount } from "../src/lib/provision-investigator";
import { readArguments } from "../scripts/provision-investigator.mts";

const root = fileURLToPath(new URL("..", import.meta.url));
const passwordArgumentError =
  "Do not pass the password as a command-line argument";

const passwordArguments = [
  {
    label: "--password=value",
    args: ["--password=cli-dummy-equals"],
    secret: "cli-dummy-equals",
  },
  {
    label: "--password value",
    args: ["--password", "cli-dummy-split"],
    secret: "cli-dummy-split",
  },
  {
    label: "-p=value",
    args: ["-p=cli-dummy-short-equals"],
    secret: "cli-dummy-short-equals",
  },
  {
    label: "-p value",
    args: ["-p", "cli-dummy-short-split"],
    secret: "cli-dummy-short-split",
  },
];

function baseArguments(extra: string[]): string[] {
  return [
    "--email",
    "investigator@example.com",
    "--name",
    "Ada Lovelace",
    ...extra,
  ];
}

function rejectedPasswordError(parse: () => void, secret: string): void {
  expect(parse).toThrow(passwordArgumentError);
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toBe(passwordArgumentError);
    expect(message).not.toContain(secret);
  }
}

function provisionCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--experimental-strip-types",
      path.join(root, "scripts/provision-investigator.mts"),
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      timeout: 20_000,
    },
  );
}

describe("provisioning password arguments", () => {
  it.each(passwordArguments)(
    "rejects $label without including the supplied password",
    ({ args, secret }) => {
      rejectedPasswordError(
        () => readArguments(baseArguments(args)),
        secret,
      );
    },
  );

  it("writes a fixed error for every rejected password argument", () => {
    for (const { args, secret } of passwordArguments) {
      const result = provisionCli(baseArguments(args));
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

      expect(result.status).toBe(1);
      expect(output).toContain(passwordArgumentError);
      expect(output).not.toContain(secret);
      expect(output).not.toContain("Unknown argument");
    }
  }, 90_000);
});

describe("provisioning password length", () => {
  async function rejectedAccount(password: string, message: string) {
    const email = `rejected-${randomUUID()}@example.com`;

    await expect(
      createInvestigatorAccount({
        email,
        name: "Rejected Password",
        password,
        confirmInvestigator: true,
      }),
    ).rejects.toThrow(message);

    try {
      await createInvestigatorAccount({
        email,
        name: "Rejected Password",
        password,
        confirmInvestigator: true,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const text = (error as Error).message;
      expect(text).toBe(message);
      expect(text).not.toContain(password);
    }

    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    expect(rows).toEqual([]);
  }

  it("rejects a password shorter than 12 characters before creating an account", async () => {
    await rejectedAccount("a".repeat(11), "Password must be at least 12 characters");
  });

  it("rejects a password longer than 128 characters before creating an account", async () => {
    await rejectedAccount(
      "d".repeat(129),
      "Password must be at most 128 characters",
    );
  });

  it("accepts passwords at the 12 and 128 character boundaries", async () => {
    const minimum = await createInvestigatorAccount({
      email: `min-${randomUUID()}@example.com`,
      name: "Minimum Password",
      password: "b".repeat(12),
      confirmInvestigator: true,
    });
    const maximum = await createInvestigatorAccount({
      email: `max-${randomUUID()}@example.com`,
      name: "Maximum Password",
      password: "c".repeat(128),
      confirmInvestigator: true,
    });

    expect(minimum.role).toBe("INVESTIGATOR");
    expect(maximum.role).toBe("INVESTIGATOR");
  });
});
