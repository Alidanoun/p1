import { useQuery } from '@tanstack/react-query';
import api, { unwrap } from '../../api/client';

/**
 * 🏢 useBranchStatus Hook
 * Monitors the operational status of a branch (Open, Closed, Emergency).
 */
export const useBranchStatus = (branchId) => {
  return useQuery({
    queryKey: ['branchStatus', branchId],
    queryFn: async () => {
      const response = await api.get('/restaurant/status', {
        params: { branchId }
      });
      return unwrap(response);
    },
    enabled: !!branchId && branchId !== 'null',
    staleTime: 60000,
  });
};
