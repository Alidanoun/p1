import { useQuery } from '@tanstack/react-query';
import api, { unwrap } from '../../api/client';

/**
 * 📊 useBranchStats Hook
 * Fetches real-time dashboard metrics (gross revenue, order counts, status distribution).
 */
export const useBranchStats = (branchId) => {
  return useQuery({
    queryKey: ['branchStats', branchId],
    queryFn: async () => {
      const response = await api.get('/analytics/dashboard', {
        params: { branchId }
      });
      return unwrap(response);
    },
    enabled: !!branchId && branchId !== 'null',
    staleTime: 30000, // Metrics can be slightly more stale than orders
    refetchInterval: 60000 // Background safety poll
  });
};
