import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeTransactionIngestion } from "../src/lib/ingestion-auth";

const originalToken = process.env.TRANSACTION_INGESTION_TOKEN;

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.TRANSACTION_INGESTION_TOKEN;
    return;
  }
  process.env.TRANSACTION_INGESTION_TOKEN = originalToken;
});

describe("transaction ingestion credential", () => {
  it("returns 503 when the server credential is missing or empty", () => {
    for (const configured of [undefined, "", "   "]) {
      if (configured === undefined) {
        delete process.env.TRANSACTION_INGESTION_TOKEN;
      } else {
        process.env.TRANSACTION_INGESTION_TOKEN = configured;
      }

      const result = authorizeTransactionIngestion(
        `Bearer ${randomBytes(32).toString("hex")}`,
      );

      expect(result).toEqual({
        ok: false,
        status: 503,
        error: "Transaction ingestion is unavailable",
      });
    }
  });

  it("rejects missing, malformed, and unequal credentials without throwing", () => {
    const configured = randomBytes(32).toString("hex");
    process.env.TRANSACTION_INGESTION_TOKEN = configured;

    expect(authorizeTransactionIngestion(null)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(authorizeTransactionIngestion("Bearer")).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(authorizeTransactionIngestion("Bearer ")).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      authorizeTransactionIngestion(`Bearer ${configured} extra`),
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      authorizeTransactionIngestion(`Bearer ${configured.slice(0, 8)}`),
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      authorizeTransactionIngestion(`Basic ${configured}`),
    ).toMatchObject({ ok: false, status: 401 });

    const wrongLength = authorizeTransactionIngestion("Bearer short");
    expect(wrongLength).toEqual({
      ok: false,
      status: 401,
      error: "Authentication required",
    });
    expect(JSON.stringify(wrongLength)).not.toContain(configured);
  });

  it("accepts only the configured bearer credential", () => {
    const configured = randomBytes(32).toString("hex");
    process.env.TRANSACTION_INGESTION_TOKEN = configured;
    const sameLengthWrong = `${configured.slice(0, -1)}${
      configured.endsWith("a") ? "b" : "a"
    }`;

    expect(
      authorizeTransactionIngestion(`Bearer ${sameLengthWrong}`),
    ).toMatchObject({ ok: false, status: 401 });
    expect(authorizeTransactionIngestion(`Bearer ${configured}`)).toEqual({
      ok: true,
    });
  });
});
