import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../api/client';
import { toast } from 'sonner';
import { Shield, Lock } from 'lucide-react';

const PinGuard = ({ children }) => {
  const { user } = useAuth();
  const [isVerified, setIsVerified] = useState(false);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const role = user?.role?.toLowerCase();
  const isBranchManager = role === 'manager' || role === 'branch_manager';

  useEffect(() => {
    // If not a branch manager, no PIN needed
    if (!isBranchManager) {
      setIsVerified(true);
      return;
    }

    const lastVerified = sessionStorage.getItem('pinVerifiedAt');
    if (lastVerified && Date.now() - parseInt(lastVerified) < 5 * 60 * 1000) {
      setIsVerified(true);
    }
  }, [isBranchManager]);

  const verifyPin = async (e) => {
    e?.preventDefault();
    if (pin.length !== 4) return;
    
    setLoading(true);
    try {
      await api.post('/branch/verify-pin', { managerPin: pin });
      sessionStorage.setItem('pinVerifiedAt', Date.now().toString());
      setIsVerified(true);
      toast.success('تم فتح القفل بنجاح');
    } catch (error) {
      toast.error(error.response?.data?.error?.message || error.response?.data?.error || 'رمز PIN غير صحيح');
      setPin('');
      document.getElementById('pin-input-0')?.focus();
    } finally {
      setLoading(false);
    }
  };

  if (isVerified) return children;

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[500px]">
      <div className="bg-card border border-border-subtle rounded-2xl p-8 max-w-sm w-full mx-4 shadow-xl relative overflow-hidden text-center">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Shield className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-xl font-bold mb-2">تأكيد الهوية</h3>
        <p className="text-text-muted text-sm mb-8">يرجى إدخال رمز الوصول الخاص بمدير الفرع</p>
        
        <form onSubmit={verifyPin} className="space-y-6">
          <div className="flex justify-center gap-3" dir="ltr">
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                id={`pin-input-${i}`}
                type="password"
                maxLength={1}
                className="w-14 h-14 text-center text-2xl font-bold rounded-xl border border-border-subtle bg-background focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={pin[i] || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val && !/^\d+$/.test(val)) return;
                  
                  const newPin = pin.split('');
                  newPin[i] = val;
                  setPin(newPin.join(''));
                  
                  if (val && i < 3) {
                    document.getElementById(`pin-input-${i + 1}`)?.focus();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !pin[i] && i > 0) {
                    document.getElementById(`pin-input-${i - 1}`)?.focus();
                  }
                }}
              />
            ))}
          </div>
          
          <button
            type="submit"
            disabled={pin.length !== 4 || loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary-hover disabled:opacity-50 transition-all"
          >
            {loading ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : (
              <>
                <Lock className="w-5 h-5" />
                فتح القفل
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PinGuard;
