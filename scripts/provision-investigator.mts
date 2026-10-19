/**
 * Create the first RiskLens investigator from a local terminal.
 *
 *   npm run auth:provision -- --email investigator@example.com --name "Ada Lovelace"
 *
 * The command prompts for a password without echoing it, then asks you to
 * type INVESTIGATOR before it assigns that role. Do not pass the password as
 * an argument, environment variable, or shell history entry.
 */
import "dotenv/config";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { acceptedDisplayName } from "../src/lib/display-name.ts";
import { closeDatabasePool } from "../src/lib/db/index.ts";
import { createInvestigatorAccount } from "../src/lib/provision-investigator.ts";

type Arguments = {
  email: string;
  name: string;
};

const passwordArgumentError =
  "Do not pass the password as a command-line argument";

function isPasswordArgument(argument: string): boolean {
  return (
    argument === "--password" ||
    argument === "-p" ||
    argument.startsWith("--password=") ||
    argument.startsWith("-p=")
  );
}

export function readArguments(argv: string[]): Arguments {
  for (const argument of argv) {
    if (isPasswordArgument(argument)) {
      throw new Error(passwordArgumentError);
    }
  }

  let email = "";
  let name = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--email") {
      email = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--name") {
      name = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length);
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!email || !name) {
    throw new Error(
      "Usage: npm run auth:provision -- --email <email> --name <display name>",
    );
  }

  return { email, name };
}

async function promptVisible(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptHidden(question: string): Promise<string> {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  process.stdout.write(question);
  try {
    return await rl.question("");
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}

async function main() {
  const { email, name: requestedName } = readArguments(process.argv.slice(2));
  const name = acceptedDisplayName(requestedName);

  if (!process.stdin.isTTY) {
    throw new Error("Run this command in an interactive terminal");
  }
  const password = await promptHidden("Password: ");
  const confirmation = await promptVisible(
    "Type INVESTIGATOR to assign the investigator role: ",
  );

  const account = await createInvestigatorAccount({
    email,
    name,
    password,
    confirmInvestigator: confirmation === "INVESTIGATOR",
  });

  process.stdout.write(
    `Created investigator ${account.email} (${account.name}), role ${account.role}, id ${account.id}\n`,
  );
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function runDirectExecution(): Promise<void> {
  try {
    await main();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provisioning failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    try {
      await closeDatabasePool();
    } catch {
      process.stderr.write("Unable to close the provisioning database pool\n");
      process.exitCode = 1;
    }
  }
}

if (isDirectExecution()) {
  void runDirectExecution();
}
