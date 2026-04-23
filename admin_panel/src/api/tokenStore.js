/**
 * 🔒 In-Memory Token Store
 * Purpose: Keeps the Access Token in memory only to prevent XSS theft.
 * The token is lost on page refresh and must be re-acquired via the HttpOnly Refresh Cookie.
 */

let accessToken = null;
const listeners = new Set();

export const tokenStore = {
  /**
   * Get the current access token
   */
  get: () => accessToken,

  /**
   * Set a new access token and notify subscribers
   */
  set: (token) => {
    accessToken = token;
    listeners.forEach(fn => fn(token));
  },

  /**
   * Clear the token (Logout)
   */
  clear: () => {
    accessToken = null;
    listeners.forEach(fn => fn(null));
  },

  /**
   * Subscribe to token changes (e.g. for Socket.io re-auth)
   */
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
};
