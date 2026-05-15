import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../constants/permissions';

/**
 * 🔐 usePermissions Hook
 * Provides a declarative and centralized way to check user authorities.
 * Usage: const { can, role } = usePermissions();
 */
export const usePermissions = () => {
  const { user } = useAuth();
  
  const role = useMemo(() => user?.role?.toUpperCase(), [user]);
  
  const can = useMemo(() => {
    return (permission) => hasPermission(role, permission);
  }, [role]);

  return {
    can,
    role,
    isAdmin: role === 'ADMIN',
    isManager: role === 'BRANCH_MANAGER',
    isStaff: role === 'STAFF',
    user
  };
};
