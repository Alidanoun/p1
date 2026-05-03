import { Component } from 'react';
import api from '../api/client';

/**
 * 🛡️ Advanced Error Boundary
 * Catch crashes, log to backend, and provide a graceful recovery UI.
 */
class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // 📊 Log critical frontend error to backend
    console.error('Critical UI Failure:', error, errorInfo);
    
    api.post('/system/logs/frontend-error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent
    }).catch(() => {
      // Fail silently if logging also fails
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0f172a] p-4 text-center">
          <div className="max-w-md w-full bg-[#1e293b] border border-white/10 p-8 rounded-3xl shadow-2xl">
            <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            
            <h1 className="text-2xl font-black text-white mb-3">حدث خطأ مفاجئ</h1>
            <p className="text-slate-400 mb-8 leading-relaxed">
              عذراً، واجه التطبيق مشكلة تقنية غير متوقعة. تم إرسال تقرير للمطورين لحل المشكلة.
            </p>
            
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-primary text-white font-bold rounded-2xl hover:brightness-110 transition-all shadow-lg shadow-primary/20"
              >
                إعادة تحميل الصفحة
              </button>
              
              <button 
                onClick={() => window.location.href = '/'}
                className="w-full py-4 bg-white/5 text-slate-400 font-medium rounded-2xl hover:bg-white/10 transition-all"
              >
                العودة للرئيسية
              </button>
            </div>
            
            {process.env.NODE_ENV === 'development' && (
              <pre className="mt-8 p-4 bg-black/30 rounded-xl text-left text-[10px] text-red-400 overflow-auto max-h-40 font-mono">
                {this.state.error?.toString()}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
