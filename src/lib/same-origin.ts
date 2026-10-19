import "server-only";

import { applicationOrigin } from "./application-origin.ts";

const expectedOrigin = new URL(applicationOrigin);

export function sameOrigin(origin: string, expected: URL): boolean {
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }

  if (candidate.username !== "" || candidate.password !== "") {
    return false;
  }
  if (
    candidate.pathname !== "/" ||
    candidate.search !== "" ||
    candidate.hash !== ""
  ) {
    return false;
  }

  return (
    candidate.protocol === expected.protocol &&
    candidate.hostname === expected.hostname &&
    candidate.port === expected.port
  );
}

// Browsers send Origin on PATCH. A present value is compared as a URL
// (scheme, hostname, and port) and is never taken from Host or a forwarded
// host. When Origin is omitted, Sec-Fetch-Site is a forbidden header that
// page script cannot forge: only a same-origin browser request is accepted,
// and cross-site, same-site, and none are rejected. A client that sends
// neither header is not a browser, so it is not treated as a cross-site
// document request.
export function stateChangingRequestAllowed(headers: {
  get(name: string): string | null;
}): boolean {
  const origin = headers.get("origin");
  if (origin !== null) {
    return sameOrigin(origin, expectedOrigin);
  }

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite === null) {
    return true;
  }

  return fetchSite === "same-origin";
}
