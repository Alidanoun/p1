import { useMemo } from 'react';

/**
 * Custom hook to evaluate customer risk/blacklist status on the frontend.
 */
export const useBlacklistStatus = (customer) => {
  return useMemo(() => {
    if (!customer) return { isActive: false, status: 'NONE' };

    const now = new Date();
    const isExpired = customer.blacklistExpiresAt && new Date(customer.blacklistExpiresAt) < now;
    
    // Active if the flag is set and not expired
    const isActive = customer.isBlacklisted && !isExpired;
    const isTemporary = !!customer.blacklistExpiresAt;

    let status = 'NONE';
    if (isActive) {
      status = isTemporary ? 'TEMPORARY' : 'ACTIVE';
    } else if (customer.isBlacklisted && isExpired) {
      status = 'EXPIRED';
    }

    return {
      isActive,
      isExpired,
      isTemporary,
      status
    };
  }, [customer]);
};
