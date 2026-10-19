import { describe, expect, it } from "vitest";
import {
  applicationOrigin,
  secureCookiesEnabled,
} from "../src/lib/application-origin";
import { sameOrigin, stateChangingRequestAllowed } from "../src/lib/same-origin";

describe("origin comparison", () => {
  const expected = new URL("https://app.example.com");

  it("matches scheme, hostname, and port, including default ports", () => {
    expect(sameOrigin("https://app.example.com", expected)).toBe(true);
    expect(sameOrigin("https://app.example.com:443", expected)).toBe(true);
    expect(sameOrigin("https://APP.EXAMPLE.COM", expected)).toBe(true);
  });

  it("rejects a different scheme, host, port, or unusable value", () => {
    expect(sameOrigin("http://app.example.com", expected)).toBe(false);
    expect(sameOrigin("https://evil.example", expected)).toBe(false);
    expect(sameOrigin("https://app.example.com:8443", expected)).toBe(false);
    expect(sameOrigin("https://user:secret@app.example.com", expected)).toBe(
      false,
    );
    expect(sameOrigin("https://app.example.com/alerts", expected)).toBe(false);
    expect(sameOrigin("null", expected)).toBe(false);
    expect(sameOrigin("not a url", expected)).toBe(false);
  });
});

describe("state-changing request policy", () => {
  it("accepts the configured origin and a same-origin fetch site", () => {
    expect(
      stateChangingRequestAllowed(new Headers({ origin: applicationOrigin })),
    ).toBe(true);
    expect(
      stateChangingRequestAllowed(
        new Headers({ "sec-fetch-site": "same-origin" }),
      ),
    ).toBe(true);
  });

  it("rejects a cross-site request even when forwarded host matches", () => {
    const headers = new Headers({
      "sec-fetch-site": "cross-site",
      host: new URL(applicationOrigin).host,
      "x-forwarded-host": new URL(applicationOrigin).host,
    });

    expect(stateChangingRequestAllowed(headers)).toBe(false);
    expect(
      stateChangingRequestAllowed(new Headers({ "sec-fetch-site": "same-site" })),
    ).toBe(false);
  });
});

describe("secure cookies", () => {
  it("enables secure cookies for an HTTPS origin outside production", () => {
    expect(secureCookiesEnabled("https:", "development")).toBe(true);
    expect(secureCookiesEnabled("https:", "test")).toBe(true);
    expect(secureCookiesEnabled("http:", "production")).toBe(true);
    expect(secureCookiesEnabled("http:", "development")).toBe(false);
  });
});
