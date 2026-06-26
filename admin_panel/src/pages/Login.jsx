import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Lock, Mail, Key, ArrowLeft } from 'lucide-react';
import { getSafeRedirectPath } from '../lib/utils';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Forgot/Reset states
  const [mode, setMode] = useState('login'); // 'login' | 'forgot' | 'reset'
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { user, login, forgotPassword, resetPassword } = useAuth();
  const location = useLocation();

  // 🛡️ Stateful Redirect: Return user to intended destination or dashboard
  if (user) {
    const destination = getSafeRedirectPath(location.state?.from);
    return <Navigate to={destination} replace />;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    // 🛡️ Client-side validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('يرجى إدخال بريد إلكتروني صالح');
      setIsLoading(false);
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      setIsLoading(false);
      return;
    }
    
    const result = await login(email, password);
    if (!result.success) {
      setError(result.error);
    }
    setIsLoading(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('يرجى إدخال بريد إلكتروني صالح');
      setIsLoading(false);
      return;
    }

    const result = await forgotPassword(email);
    if (result.success) {
      setSuccess('إذا كان البريد مسجلاً، فقد تم إرسال كود التحقق إليه');
      setMode('reset');
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    if (code.length < 4) {
      setError('كود التحقق غير صالح');
      setIsLoading(false);
      return;
    }
    if (newPassword.length < 6) {
      setError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
      setIsLoading(false);
      return;
    }

    const result = await resetPassword(email, code, newPassword);
    if (result.success) {
      setSuccess('تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول.');
      setMode('login');
      setPassword('');
      setCode('');
      setNewPassword('');
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-dark)' }}>
      <div className="glass-panel slide-up" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
            <img src="/logo.png" alt="المركزية" style={{ width: '140px', height: 'auto', objectFit: 'contain' }} />
          </div>
          
          {mode === 'login' && (
            <>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>المركزية - لوحة التحكم</h2>
              <p style={{ color: 'var(--text-muted)' }}>تسجيل الدخول للمدراء فقط</p>
            </>
          )}
          {mode === 'forgot' && (
            <>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>استعادة كلمة المرور</h2>
              <p style={{ color: 'var(--text-muted)' }}>أدخل بريدك الإلكتروني لإرسال كود التحقق</p>
            </>
          )}
          {mode === 'reset' && (
            <>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>تعيين كلمة المرور الجديدة</h2>
              <p style={{ color: 'var(--text-muted)' }}>أدخل رمز التحقق وكلمة المرور الجديدة</p>
            </>
          )}
        </div>

        {error && <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '12px', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'center', fontSize: '0.9rem' }}>{error}</div>}
        {success && <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '12px', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'center', fontSize: '0.9rem' }}>{success}</div>}

        {mode === 'login' && (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ position: 'relative' }}>
              <Mail style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} size={20} />
              <input 
                type="email" 
                className="glass-input" 
                style={{ paddingRight: '48px' }} 
                placeholder="البريد الإلكتروني" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
              />
            </div>

            <div style={{ position: 'relative' }}>
              <Lock style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} size={20} />
              <input 
                type="password" 
                className="glass-input" 
                style={{ paddingRight: '48px' }} 
                placeholder="كلمة المرور" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required 
              />
            </div>

            <div style={{ textAlign: 'left', marginTop: '-0.4rem' }}>
              <button 
                type="button" 
                onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                نسيت كلمة المرور؟
              </button>
            </div>

            <button type="submit" className="glass-button" disabled={isLoading} style={{ marginTop: '0.5rem' }}>
              {isLoading ? 'جاري الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ position: 'relative' }}>
              <Mail style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} size={20} />
              <input 
                type="email" 
                className="glass-input" 
                style={{ paddingRight: '48px' }} 
                placeholder="البريد الإلكتروني للمسؤول" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
              />
            </div>

            <button type="submit" className="glass-button" disabled={isLoading} style={{ marginTop: '0.5rem' }}>
              {isLoading ? 'جاري الإرسال...' : 'إرسال كود التحقق'}
            </button>

            <button 
              type="button" 
              className="glass-button secondary"
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              <ArrowLeft size={16} /> العودة لتسجيل الدخول
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ position: 'relative' }}>
              <Mail style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} size={20} />
              <input 
                type="email" 
                className="glass-input" 
                style={{ paddingRight: '48px' }} 
                placeholder="البريد الإلكتروني" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
              />
            </div>

            <div style={{ position: 'relative' }}>
              <Key style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} size={20} />
              <input 
                type="text" 
                className="glass-input" 
                style={{ paddingRight: '48px' }} 
                placeholder="كود التحقق (OTP)" 
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required 
              />
            </div>

            <div style={{ position: 'relative' }}>
              <Lock style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} size={20} />
              <input 
                type="password" 
                className="glass-input" 
                style={{ paddingRight: '48px' }} 
                placeholder="كلمة المرور الجديدة" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required 
              />
            </div>

            <button type="submit" className="glass-button" disabled={isLoading} style={{ marginTop: '0.5rem' }}>
              {isLoading ? 'جاري تعيين كلمة المرور...' : 'تحديث كلمة المرور'}
            </button>

            <button 
              type="button" 
              className="glass-button secondary"
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              <ArrowLeft size={16} /> إلغاء والعودة
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;
