/**
 * Canonical single-source-of-truth check for whether a user currently has active Premium access.
 */
export function isUserPremiumActive(
  user?: {
    isPremium?: boolean | null;
    premiumExpiresAt?: Date | string | null;
  } | null,
  now: Date = new Date(),
): boolean {
  if (!user?.isPremium) return false;
  if (!user.premiumExpiresAt) return true;
  const expiresAt =
    user.premiumExpiresAt instanceof Date
      ? user.premiumExpiresAt
      : new Date(user.premiumExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > now.getTime();
}
