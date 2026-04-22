import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Lock, Mail, Utensils } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('admin@admin.com');
  const [password, setPassword] = useState('123456');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { login } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    const result = await login(email, password);
    if (!result.success) {
      setError(result.error);
    }
    setIsLoading(false);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-dark)' }}>
      <div className="glass-panel slide-up" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <Utensils color="var(--primary)" size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>المركزية - لوحة التحكم</h2>
          <p style={{ color: 'var(--text-muted)' }}>تسجيل الدخول للمدراء فقط</p>
        </div>

        {error && <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '12px', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'center' }}>{error}</div>}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ position: 'relative' }}>
            <Mail style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={20} />
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
            <Lock style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={20} />
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

          <button type="submit" className="glass-button" disabled={isLoading} style={{ marginTop: '1rem' }}>
            {isLoading ? 'جاري الدخول...' : 'تسجيل الدخول'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
