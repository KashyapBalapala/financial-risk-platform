export const maximumDisplayNameLength = 128;

const displayNameRequired = "A display name is required";
const displayNameTooLong = "Display name must be at most 128 characters";

export function acceptedDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(displayNameRequired);
  }
  if (trimmed.length > maximumDisplayNameLength) {
    throw new Error(displayNameTooLong);
  }
  return trimmed;
}

export function storedDisplayNameError(name: string): string | null {
  if (!name.trim()) {
    return displayNameRequired;
  }
  if (name.length > maximumDisplayNameLength) {
    return displayNameTooLong;
  }
  return null;
}
