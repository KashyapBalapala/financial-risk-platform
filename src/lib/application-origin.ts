import "server-only";

function configuredApplicationUrl(): URL {
  const value = process.env.BETTER_AUTH_URL?.trim();
  if (!value) {
    throw new Error("BETTER_AUTH_URL is not configured");
  }
  return new URL(value);
}

const applicationUrl = configuredApplicationUrl();

export const applicationOrigin = applicationUrl.origin;

export const applicationProtocol = applicationUrl.protocol;

export function secureCookiesEnabled(
  protocol: string,
  nodeEnv: string | undefined,
): boolean {
  return protocol === "https:" || nodeEnv === "production";
}
