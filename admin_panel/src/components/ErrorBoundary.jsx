import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends Component {
  state = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('🔴 UI Error caught by boundary:', error);
    console.error('Component stack:', info.componentStack);
    this.setState({ info });
  }

  reset = () => this.setState({ hasError: false, error: null, info: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="p-8 max-w-2xl mx-auto mt-12">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-8 h-8 text-red-500" />
            <h2 className="text-2xl font-bold text-white">حدث خطأ في هذه الصفحة</h2>
          </div>
          
          <p className="text-text-muted mb-4">
            بقية الموقع لا تزال تعمل بشكل طبيعي. يمكنك الانتقال لصفحة أخرى من القائمة الجانبية.
          </p>
          
          <details className="mb-4 text-xs text-text-muted">
            <summary className="cursor-pointer text-red-400 mb-2">تفاصيل تقنية</summary>
            <pre className="bg-black/30 p-3 rounded overflow-auto max-h-40 text-right" dir="ltr">
              {this.state.error?.message}
              {'\n\n'}
              {this.state.info?.componentStack?.substring(0, 500)}
            </pre>
          </details>
          
          <div className="flex gap-2">
            <button 
              onClick={this.reset}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة المحاولة
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-white/5 text-white rounded-lg hover:bg-white/10"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
