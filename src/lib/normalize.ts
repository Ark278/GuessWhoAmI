import { Identity } from "./identities";

/**
 * Normalizes text by removing accents, non-alphanumeric chars, and lowercasing
 */
export function normalizeString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // strip all punctuation, spaces, dashes
    .trim();
}

/**
 * Validates a user guess against an identity's primary name and aliases
 */
export function isCorrectGuess(guess: string, identity: Identity): boolean {
  const normalizedGuess = normalizeString(guess);
  if (!normalizedGuess || normalizedGuess.length < 2) return false;

  const normalizedName = normalizeString(identity.name);
  if (normalizedGuess === normalizedName) return true;

  // Check aliases
  for (const alias of identity.aliases) {
    if (normalizedGuess === normalizeString(alias)) {
      return true;
    }
  }

  // Handle common single-surname or primary name match if distinct enough
  const nameParts = identity.name.split(" ").map(normalizeString).filter(p => p.length >= 4);
  for (const part of nameParts) {
    if (normalizedGuess === part) {
      return true;
    }
  }

  return false;
}
