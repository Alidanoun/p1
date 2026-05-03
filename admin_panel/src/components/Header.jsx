import { useState, useRef, useEffect } from 'react';
import { Bell, Search, User, CheckCircle, X, Clock, RefreshCw, ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';
import BranchSwitcher from './BranchSwitcher';

const Header = ({ title, subtitle, action }) => {
  const { user, selectedBranchId, setSelectedBranchId } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead, fetchNotifications } = useSocket();
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = (n, autoOpen = false) => {
    if (!n.isRead) markAsRead(n.id);
    
    if (n.targetRoute) {
      // If it's an order, navigate with the orderId and autoOpen flag
      navigate(n.targetRoute, { 
        state: { 
          orderId: n.orderId, 
          autoDetails: autoOpen 
        } 
      });
      setShowNotifications(false);
    }
  };

  return (
    <header className="relative z-[100] flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-card/40 p-6 rounded-2xl border border-white/5 backdrop-blur-md">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-text-muted mt-1">{subtitle}</p>
        )}
      </div>
      
      <div className="flex items-center gap-4">
        {action && <div className="ml-2">{action}</div>}
        {/* Search */}
        <div className="hidden lg:flex items-center gap-2 bg-background border border-slate-700/50 rounded-full px-4 py-2 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all text-sm">
          <Search className="w-4 h-4 text-text-muted" />
          <input 
            type="text" 
            placeholder="بحث عن طلب..." 
            className="bg-transparent border-none outline-none text-white w-48 placeholder:text-slate-500"
          />
        </div>

        {/* Notifications Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className={`relative p-2.5 rounded-full bg-background border transition-colors ${showNotifications ? 'border-primary text-primary' : 'border-slate-700/50 text-text-muted hover:text-white hover:border-slate-500'}`}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 w-4 h-4 bg-danger text-[10px] font-bold text-white flex items-center justify-center rounded-full border-2 border-background">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute top-full mt-1 left-0 w-[420px] bg-[#1e293b]/95 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-[0_30px_60px_rgba(0,0,0,0.7)] overflow-hidden z-[9999] animate-in fade-in slide-in-from-top-2 origin-top-left ring-1 ring-white/10">
              {/* Premium Glow Accent */}
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-60 shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
              
              {/* Header & New Info */}
              <div className="p-5 border-b border-white/5 bg-white/5 relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/20 p-2 rounded-xl border border-primary/30">
                    <Bell className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white">الإشعارات</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                       <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                       <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">{unreadCount} تنبيهات جديدة</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Toolbar Section */}
              <div className="px-5 py-3 border-b border-white/5 bg-black/20 flex items-center justify-between text-[10px] text-text-muted font-bold uppercase tracking-widest">
                 <div className="flex items-center gap-2">
                    <RefreshCw 
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchNotifications();
                        toast.success('تم تحديث الإشعارات');
                      }}
                      className="w-3 h-3 text-primary cursor-pointer hover:rotate-180 transition-transform duration-500" 
                    />
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchNotifications();
                      }}
                      className="hover:text-primary transition-colors"
                    >
                      تحديث الآن
                    </button>
                 </div>
                 <div className="flex items-center gap-1.5 opacity-60">
                    <Clock className="w-3 h-3" />
                    <span>آخر تحديث: {new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                 </div>
              </div>
              
              {/* List Section */}
              <div className="max-h-[min(380px,calc(100vh-250px))] overflow-y-auto custom-scrollbar-slim p-2">
                {notifications.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-center opacity-40">
                    <Bell className="w-12 h-12 mb-4 text-slate-500" />
                    <p className="text-sm font-bold uppercase tracking-widest">صندوق الوارد فارغ</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notifications.map((n) => (
                      <div 
                        key={n.id} 
                        onClick={() => handleNotificationClick(n)}
                        className={`group p-4 rounded-2xl border border-white/5 cursor-pointer transition-all duration-300 relative flex gap-4 ${
                          !n.isRead 
                            ? 'bg-primary/5 border-primary/20 hover:bg-primary/10 hover:border-primary/30 shadow-lg shadow-primary/5' 
                            : 'bg-white/5 hover:bg-white/10 opacity-70 hover:opacity-100'
                        }`}
                      >
                        {/* Status Pulse */}
                        {!n.isRead && (
                          <div className="absolute top-4 right-4 w-2 h-2 bg-primary rounded-full shadow-[0_0_10px_rgba(249,115,22,0.8)] animate-pulse" />
                        )}

                        <div className={`mt-0.5 shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-300 ${
                          !n.isRead 
                            ? 'bg-primary/20 border-primary/40 text-primary shadow-inner group-hover:scale-110' 
                            : 'bg-slate-800/50 border-white/5 text-slate-500'
                        }`}>
                          {n.type === 'order_created' ? <Bell className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-1 gap-4">
                            <p className={`text-sm leading-tight ${!n.isRead ? 'text-white font-black' : 'text-slate-300 font-bold'}`}>
                               {n.title}
                            </p>
                            <span className={`text-[9px] px-2 py-0.5 rounded-full border shrink-0 font-black uppercase tracking-tighter ${
                              !n.isRead ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-white/5 border-white/10 text-slate-500'
                            }`}>
                              {!n.isRead ? 'جديد' : 'تم العرض'}
                            </span>
                          </div>
                          
                          <p className="text-xs text-slate-400 font-medium leading-relaxed mb-3 line-clamp-2">
                            {n.message}
                          </p>

                          <div className="flex items-center justify-between border-t border-white/5 pt-3 mt-1 group-hover:border-white/10 transition-colors">
                             <div className="flex items-center gap-2">
                               <div className="w-1 h-1 rounded-full bg-primary/40" />
                               <span className="text-[10px] font-bold text-primary/70 font-mono tracking-tighter">
                                 #{n.refId || (n.orderId ? `ORD-${n.orderId}` : (n.id ? `NOTIF-${String(n.id).substring(0, 5)}` : 'UNKNOWN'))}
                               </span>
                             </div>
                             
                             <div className="flex items-center gap-3">
                                {n.targetRoute && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleNotificationClick(n, true);
                                    }}
                                    className="text-[10px] font-black text-primary flex items-center gap-1 hover:underline active:scale-95 transition-all"
                                  >
                                     <ExternalLink className="w-3 h-3" />
                                     <span>عرض التفاصيل</span>
                                  </button>
                                )}
                                <div className="flex items-center gap-1.5 opacity-60">
                                   <Clock className="w-3 h-3" />
                                   <span className="text-[10px] font-bold text-slate-500">
                                      {n.createdAt ? (() => {
                                        try {
                                          return formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ar });
                                        } catch (e) {
                                          return 'منذ فترة';
                                        }
                                      })() : 'الآن'}
                                   </span>
                                </div>
                             </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Footer - Now Fixed */}
              <div className="p-4 bg-[#1e293b] border-t border-white/10 grid grid-cols-2 gap-3 shadow-[0_-10px_30px_rgba(0,0,0,0.3)]">
                 <button 
                  onClick={() => {
                    const latestOrder = notifications?.find(n => n.orderId);
                    if (latestOrder) handleNotificationClick(latestOrder, true);
                    else navigate('/orders');
                    setShowNotifications(false);
                  }}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[11px] font-bold text-slate-300 transition-all border border-white/5 active:scale-[0.98]"
                 >
                    <span>عرض كل الطلبات</span>
                 </button>
                 <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    markAllAsRead?.();
                  }}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-[11px] font-black text-primary transition-all border border-primary/20 active:scale-[0.98]"
                 >
                    <CheckCircle className="w-4 h-4" />
                    <span>تحديد المقروء</span>
                 </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Branch Switcher (Admin Only) */}
        {(user?.role?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'SUPER_ADMIN') && (
          <BranchSwitcher 
            selectedBranchId={selectedBranchId} 
            onBranchChange={setSelectedBranchId} 
          />
        )}
        
        {/* Profile */}
        <div className="flex items-center gap-3 bg-background border border-slate-700/50 pl-2 pr-4 py-1.5 rounded-full">
          <div className="text-right">
            <p className="text-sm font-bold text-white">
              {(user?.role === 'super_admin' || user?.role === 'admin') 
                ? 'المدير العام' 
                : (user?.branchName ? `فرع ${user.branchName}` : 'مدير الفرع')}
            </p>
            <p className="text-xs text-text-muted">{user?.email || 'admin@almarkazia.com'}</p>
          </div>
          <div className="w-9 h-9 bg-primary/20 border border-primary/30 rounded-full flex items-center justify-center text-primary">
            <User className="w-5 h-5" />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
