import { useQuery } from '@tanstack/react-query';
import api, { unwrap } from '../../api/client';

/**
 * 📦 useOrders Hook (SSOT)
 * Authoritative source for the live orders list.
 * Scoped strictly by branchId to ensure multi-tenant isolation.
 */
export const useOrders = (branchId) => {
  return useQuery({
    queryKey: ['orders', branchId],
    queryFn: async () => {
      console.log(`📡 [Query] Fetching authoritative orders for branch: ${branchId}`);
      const response = await api.get('/orders');
      return unwrap(response) || [];
    },
    // 🛡️ Guard: Only fetch if we have a valid branch context
    enabled: !!branchId && branchId !== 'null',
    
    // 🧠 [SDS-HARDENING] Production Resilience
    staleTime: 15000,      // 🛡️ Protect against rapid navigation flicker
    gcTime: 1000 * 60 * 10, // 10 min cache persistence
    retry: 3,               // Robustness for transient network failures
    retryDelay: (attempt) => Math.min(attempt * 1000, 5000), 
    refetchOnReconnect: true,
    refetchOnWindowFocus: false, // Managed manually via Sockets/Invalidation
    
    // 📋 Transformation: Ensure the data is always an array
    select: (data) => Array.isArray(data) ? data : []
  });
};
