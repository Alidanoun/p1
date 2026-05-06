import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/**
 * 🛡️ Safe Redirect Validator
 * Ensures the redirect path is internal and prevents Open Redirect attacks.
 */
export const getSafeRedirectPath = (path, defaultPath = '/') => {
  if (!path || typeof path !== 'string') return defaultPath;

  // 1. Prevent protocol-relative URLs (e.g., //evil.com)
  if (path.startsWith('//')) return defaultPath;

  // 2. Allow only internal paths starting with /
  // And block anything containing a protocol (http://, https://, etc.)
  const isInternal = path.startsWith('/') && !path.match(/^[a-z0-9]+:\/\//i);

  return isInternal ? path : defaultPath;
};

/**
 * 🍪 Cookie Retrieval Utility
 */
export const getCookie = (name) => {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
};
