import { useState, useEffect, useRef } from 'react';
import { AuthContext } from './AuthContext';
import api, { executeRefresh, isValidBranchId } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import { toast } from 'sonner';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const [selectedBranchId, setBranchIdState] = useState(() => {
    const saved = localStorage.getItem('selectedBranchId') || sessionStorage.getItem('selectedBranchId');
    return isValidBranchId(saved) ? saved : null;
  });

  const setSelectedBranchId = (id) => {
    const validId = isValidBranchId(id) ? String(id) : null;
    setBranchIdState(validId);
    if (validId && validId !== 'all') {
      localStorage.setItem('selectedBranchId', validId);
      sessionStorage.setItem('selectedBranchId', validId);
    } else {
      localStorage.removeItem('selectedBranchId');
      sessionStorage.removeItem('selectedBranchId');
    }
  };

  /**
   * 🛡️ 3-Level Rehydration Strategy:
   * 1. LocalStorage (Immediate/Optimistic)
   * 2. executeRefresh (Server-side validation)
   * 3. State Update (Final consistency)
   */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 🛡️ Safety Guard: Force loading to false after 5s to prevent infinite hang
    const safetyTimer = setTimeout(() => {
      setLoading(currentLoading => {
        if (currentLoading) {
          console.warn('🧪 [AuthBootstrap] Safety timeout triggered. Forcing UI release.');
        }
        return false;
      });
    }, 5000);

    const bootstrap = async () => {
      try {
        console.log('🧪 [AuthBootstrap] Phase 1: Checking cache...');
        const cachedUser = sessionStorage.getItem('user_cache') || localStorage.getItem('user_cache');
        if (cachedUser) {
          try {
            // 🛡️ Do NOT set the active authenticated user from unverified cache
            // We only parse it to verify format and handle potential cleanup
            JSON.parse(cachedUser);
            console.log('🧪 [AuthBootstrap] Cache session detected, awaiting server validation...');
          } catch (e) {
            sessionStorage.removeItem('user_cache');
            localStorage.removeItem('user_cache');
          }
        }

        try {
          console.log('🧪 [AuthBootstrap] Phase 2: Server-side validation...');
          await executeRefresh();
          console.log('🧪 [AuthBootstrap] Refresh successful');

          console.log('🧪 [AuthBootstrap] Phase 3: Fetching profile...');
          const meResponse = await api.get('/auth/me');
          const finalUser = meResponse.data.data;
          setUser(finalUser);
          sessionStorage.setItem('user_cache', JSON.stringify(finalUser));
          localStorage.removeItem('user_cache');
          
          // Auto-set branchId for manager/branch_manager
          const role = finalUser.role?.toLowerCase();
          if ((role === 'branch_manager' || role === 'manager') && finalUser.branchId) {
            setSelectedBranchId(finalUser.branchId);
          }
          console.log('🧪 [AuthBootstrap] Profile sync complete');
        } catch (err) {
          console.warn('🧪 [AuthBootstrap] FAILED:', err.response?.data?.error || err.message);
          tokenStore.clear();
          setUser(null);
          sessionStorage.removeItem('user_cache');
          localStorage.removeItem('user_cache');
        } finally {
          console.log('🧪 [AuthBootstrap] Phase 4: Setting loading to false');
          setLoading(false);
          clearTimeout(safetyTimer);
        }
      } catch (criticalError) {
        setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    bootstrap();
  }, []);

  // 🛡️ Secure Session Bootstrapping: Validate savedBranchId on load or user change
  useEffect(() => {
    const validateBranchOnLoad = async () => {
      const savedBranch = localStorage.getItem('selectedBranchId');
      
      if (savedBranch && savedBranch !== 'null' && user?.role?.toUpperCase() === 'ADMIN') {
        try {
          // Check backend to make sure the branch is still valid & accessible
          const { data } = await api.post('/branch/validate', { 
            branchId: savedBranch
          });
          
          if (!data.success || !data.canAccess) {
            // Clear invalid branch selection
            localStorage.removeItem('selectedBranchId');
            setBranchIdState(null);
            toast.warning('تم تحديث صلاحيات الفروع، يرجى الاختيار مجدداً');
          }
        } catch (error) {
          console.warn('Failed to validate branch access during bootstrap:', error);
          // 🛡️ [SEC-FIX] Do NOT destructively clear selection on transient network/timing errors
        }
      }
    };
    
    if (!loading && user?.id) {
      const role = user.role?.toLowerCase();
      if (role === 'admin') {
        validateBranchOnLoad();
      } else if ((role === 'branch_manager' || role === 'manager') && user.branchId) {
        setSelectedBranchId(user.branchId);
      }
    }
  }, [user, loading]);

  // 🔄 Multi-Tab Synchronization: Sync active branch selection across open tabs
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'selectedBranchId') {
        const newId = e.newValue && isValidBranchId(e.newValue) ? e.newValue : null;
        setBranchIdState(prev => prev !== newId ? newId : prev);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const changeBranch = (branchId) => {
    setSelectedBranchId(branchId);
  };

  const login = async (email, password) => {
    try {
      const { data: response } = await api.post('/auth/login', { email, password });
      console.log('🧪 [AuthDebug] Login Response Data:', response);
      const authData = response.success ? response.data : response;
      const { accessToken, user } = authData;

      if (!accessToken || !user) {
        console.error('❌ [AuthDebug] Missing token or user in response:', authData);
      }

      tokenStore.set(accessToken);
      setUser(user);
      sessionStorage.setItem('user_cache', JSON.stringify(user));
      localStorage.removeItem('user_cache');
      
      const role = user.role?.toLowerCase();
      if ((role === 'branch_manager' || role === 'manager') && user.branchId) {
        setSelectedBranchId(user.branchId);
      } else {
        changeBranch(null);
        localStorage.removeItem('selectedBranchId');
      }

      console.log('✅ [AuthDebug] Login Success. User:', user.email);
      return { success: true };
    } catch (error) {
      console.error('🚨 [AuthDebug] Login Attempt Failed:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      const message = error.response?.data?.error?.message || error.response?.data?.error || 'Login failed';
      return { success: false, error: typeof message === 'string' ? message : JSON.stringify(message) };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('Logout notification failed', err);
    } finally {
      tokenStore.clear();
      setUser(null);
      setSelectedBranchId(null);
      sessionStorage.removeItem('user_cache');
      localStorage.removeItem('user_cache');
      window.location.href = '/login';
    }
  };

  const canAccess = (requiredRole) => {
    if (!user) return false;
    const role = user.role?.toLowerCase();
    // 👑 Administrative Power
    if (role === 'admin') return true;
    
    if (Array.isArray(requiredRole)) return requiredRole.includes(role);
    return role === requiredRole;
  };

  const isAuthorized = (permission, requiredLevel = 'VIEW') => {
    if (!user) return false;
    const role = user.role?.toLowerCase();
    if (role === 'admin') return true;
    
    const p = user.permissions?.[permission];
    if (!p || p === 'NONE') return false;
    
    if (requiredLevel === 'EDIT_PIN' && !['EDIT_PIN', 'EDIT_PIN_READ', 'FULL'].includes(p)) return false;
    if (requiredLevel === 'FULL' && p !== 'FULL') return false;
    
    return true;
  };

  const forgotPassword = async (email) => {
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      return { success: true, message: data.message || 'إذا كان البريد مسجلاً، ستصلك رسالة قريباً' };
    } catch (error) {
      const message = error.response?.data?.error?.message || error.response?.data?.error || 'حدث خطأ ما';
      return { success: false, error: typeof message === 'string' ? message : JSON.stringify(message) };
    }
  };

  const resetPassword = async (email, code, newPassword) => {
    try {
      const { data } = await api.post('/auth/reset-password', { email, code, newPassword });
      return { success: true, message: data.message || 'تم إعادة تعيين كلمة المرور بنجاح' };
    } catch (error) {
      const message = error.response?.data?.error?.message || error.response?.data?.error || 'حدث خطأ ما';
      return { success: false, error: typeof message === 'string' ? message : JSON.stringify(message) };
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, login, logout, loading, 
      selectedBranchId, setSelectedBranchId,
      canAccess, isAuthorized,
      forgotPassword, resetPassword
    }}>
      {children}
    </AuthContext.Provider>
  );
};
