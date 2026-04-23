import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  XCircle, User, Calendar, Clock, AlertTriangle, Hash, ShieldCheck, 
  ShieldAlert, Search, ShieldOff, Loader2, X, RefreshCw, Info,
  ExternalLink, TrendingDown, Clock3
} from 'lucide-react';
import Header from '../components/Header';
import api from '../api/client';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useDebounce } from '../hooks/useDebounce';
import { useBlacklistStatus } from '../hooks/useBlacklistStatus';
import { 
  formatBlacklistStatus, 
  getRiskScoreColor, 
  formatRiskSeverity 
} from '../lib/formatters';

const CancelledOrders = () => {
  const [cancellations, setCancellations] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Advanced State Management (CRM Tier)
  const [isBlacklistModalOpen, setIsBlacklistModalOpen] = useState(false);
  const [blacklistedCustomers, setBlacklistedCustomers] = useState([]);
  const [blacklistCount, setBlacklistCount] = useState(0);
  const [isBlacklistLoading, setIsBlacklistLoading] = useState(false);
  const [blacklistSearch, setBlacklistSearch] = useState('');
  
  // Debounced search to prevent API hammering
  const debouncedSearch = useDebounce(blacklistSearch, 500);
  
  const [unblockingId, setUnblockingId] = useState(null);
  const [confirmUnblockId, setConfirmUnblockId] = useState(null);

  // Manual Block State
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [targetCustomer, setTargetCustomer] = useState(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockForm, setBlockForm] = useState({
    reason: '',
    severity: 'LOW',
    durationDays: '0' // 0 = Permanent
  });

  const handleOpenBlockModal = (customer) => {
    setTargetCustomer({
       id: customer.id || customer.customerId,
       name: customer.name || customer.customerName,
       phone: customer.phone || customer.customerPhone
    });
    setIsBlockModalOpen(true);
  };

  const fetchCancellations = async () => {
    try {
      const { data: response } = await api.get('/orders?time_range=month');
      
      // ✅ Handle both wrapped and legacy formats
      const ordersList = Array.isArray(response) ? response : (response.data || []);
      
      // Filter for cancelled orders only.
      const cancelledOnes = ordersList.filter(o => o.status === 'cancelled');
      setCancellations(cancelledOnes);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch cancellations', error);
      setLoading(false);
    }
  };

  const calculateStats = () => {
    if (cancellations.length === 0) return { totalLoss: 0, topReason: 'N/A', customerCount: 0 };
    
    const totalLoss = cancellations.reduce((acc, order) => {
      // Logic: total - deliveryFee
      return acc + (order.total - (order.deliveryFee || 0));
    }, 0);

    const customerCount = cancellations.filter(o => o.cancellation?.cancelledBy === 'customer').length;
    const adminCount = cancellations.filter(o => o.cancellation?.cancelledBy === 'admin').length;

    return { totalLoss, customerCount, adminCount };
  };

  const fetchBlacklistCount = async () => {
    try {
      const { data: response } = await api.get('/customers/blacklist/count');
      // Already handles success: true wrapper but let's be safe
      const count = response.success ? response.data.count : (response.count || 0);
      setBlacklistCount(count);
    } catch (error) {
      console.error('Failed to fetch blacklist count', error);
    }
  };

  const fetchBlacklistedCustomers = useCallback(async () => {
    setIsBlacklistLoading(true);
    try {
      const { data: response } = await api.get(`/customers/blacklisted?search=${debouncedSearch}`);
      const customers = response.success ? response.data.customers : (Array.isArray(response) ? response : []);
      setBlacklistedCustomers(customers);
    } catch (error) {
       const msg = error.response?.data?.error?.message || 'فشل في جلب القائمة السوداء';
       toast.error(msg);
    } finally {
      setIsBlacklistLoading(false);
    }
  }, [debouncedSearch]);

  const handleUnblock = async (customer) => {
    const originalList = [...blacklistedCustomers];
    const id = customer.id;
    
    setUnblockingId(id);
    
    // Optimistic UI update
    setBlacklistedCustomers(prev => prev.filter(c => c.id !== id));
    setBlacklistCount(prev => Math.max(0, prev - 1));

    try {
    const { data } = await api.patch(`/customers/${id}/unblock`, { 
        reason: 'إزالة يدوية من لوحة التحكم (CRM Admin)' 
      });
      
      if (data.success) {
        toast.success(`تم فك الحظر عن ${customer.name} بنجاح`);
        setConfirmUnblockId(null);
        fetchBlacklistCount(); // Refresh count
      } else {
        throw new Error(data.error?.message || 'فشل فك الحظر');
      }
    } catch (error) {
      const msg = error.response?.data?.error?.message || 'فشل في فك الحظر';
      toast.error(msg);
      // Rollback on failure
      setBlacklistedCustomers(originalList);
      setBlacklistCount(originalList.length);
    } finally {
      setUnblockingId(null);
    }
  };

  const handleBlockSubmit = async (e) => {
    e.preventDefault();
    if (!blockForm.reason) return toast.error('يرجى إدخال سبب الحظر');
    
    setBlockLoading(true);
    try {
      const { data } = await api.patch(`/customers/${targetCustomer.id}/block`, {
        ...blockForm,
        durationDays: parseInt(blockForm.durationDays)
      });
      
      if (data.success) {
        toast.success(`تم حظر ${targetCustomer.name} بنجاح`);
        setIsBlockModalOpen(false);
        setBlockForm({ reason: '', severity: 'LOW', durationDays: '0' });
        fetchBlacklistCount();
        if (isBlacklistModalOpen) fetchBlacklistedCustomers();
      }
    } catch (error) {
      const msg = error.response?.data?.error?.message || 'فشل في تنفيذ الحظر';
      toast.error(msg);
    } finally {
      setBlockLoading(false);
    }
  };

  useEffect(() => {
    fetchCancellations();
    fetchBlacklistCount();
  }, []);

  useEffect(() => {
    if (isBlacklistModalOpen) {
      fetchBlacklistedCustomers();
    }
  }, [isBlacklistModalOpen, fetchBlacklistedCustomers]);

  const stats = calculateStats();

  const getStatusBadge = (status) => {
    const statuses = {
      'pending': { label: 'قيد الانتظار', color: 'text-amber-500 bg-amber-500/10' },
      'preparing': { label: 'قيد التجهيز', color: 'text-blue-500 bg-blue-500/10' },
      'ready': { label: 'جاهز للاستلام', color: 'text-purple-500 bg-purple-500/10' },
      'in_route': { label: 'في الطريق', color: 'text-orange-500 bg-orange-500/10' },
    };
    const s = statuses[status] || { label: status, color: 'text-white bg-white/10' };
    return <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold", s.color)}>{s.label}</span>;
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <Header 
          title="الطلبات الملغاة" 
          subtitle="أرشيف كامل للطلبات التي تم إلغاؤها وأسباب الإلغاء" 
        />
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsBlacklistModalOpen(true)}
            className="group relative flex items-center gap-2 px-5 py-2.5 bg-background border border-white/5 hover:border-red-500/30 rounded-xl transition-all duration-300"
          >
            <ShieldAlert className="w-4 h-4 text-red-500 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-white">إدارة القائمة السوداء</span>
            {blacklistCount > 0 && (
              <span className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white shadow-lg ring-2 ring-background animate-in zoom-in">
                {blacklistCount}
              </span>
            )}
          </button>
          
          <button 
            onClick={fetchCancellations}
            className="p-2.5 rounded-xl bg-card/60 border border-white/5 text-text-muted hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
         <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 border-r-4 border-r-red-500">
            <p className="text-xs font-bold text-text-muted mb-2">إجمالي الخسائر المالية</p>
            <div className="flex items-end gap-2">
               <h3 className="text-3xl font-black text-white">{stats.totalLoss.toFixed(2)}</h3>
               <span className="text-sm font-bold text-text-muted mb-1 underline decoration-red-500">د.أ</span>
            </div>
            <p className="text-[10px] text-text-muted mt-2">(مجموع الطلبات بدون رسوم التوصيل)</p>
         </div>
         <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 border-r-4 border-r-amber-500">
            <p className="text-xs font-bold text-text-muted mb-2">إلغاء من قبل الزبائن</p>
            <div className="flex items-end gap-2">
               <h3 className="text-3xl font-black text-white">{stats.customerCount}</h3>
               <span className="text-sm font-bold text-text-muted mb-1">طلب</span>
            </div>
            <p className="text-[10px] text-text-muted mt-2">طلبات تم إنهاؤها بقرار من العميل</p>
         </div>
         <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 border-r-4 border-r-blue-500">
            <p className="text-xs font-bold text-text-muted mb-2">إلغاء من قبل الإدارة</p>
            <div className="flex items-end gap-2">
               <h3 className="text-3xl font-black text-white">{stats.adminCount}</h3>
               <span className="text-sm font-bold text-text-muted mb-1">طلب</span>
            </div>
            <p className="text-[10px] text-text-muted mt-2">إلغاءات إدارية لأسباب تشغيلية</p>
         </div>
      </div>

      <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden">
        {loading ? (
          <div className="p-20 flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-text-muted animate-pulse">جاري تحميل السجلات...</p>
          </div>
        ) : cancellations.length === 0 ? (
          <div className="p-20 flex flex-col items-center text-center opacity-40">
            <XCircle className="w-16 h-16 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">لا يوجد طلبات ملغاة</h3>
            <p className="text-sm">سجل الإلغاءات فارغ حالياً.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-white/5">
                  <th className="p-4 text-xs font-bold text-text-muted uppercase tracking-wider"><Hash className="w-3 h-3 inline ml-1" /> رقم الطلب</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase tracking-wider"><User className="w-3 h-3 inline ml-1" /> العميل</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase tracking-wider"><AlertTriangle className="w-3 h-3 inline ml-1" /> سبب الإلغاء</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase tracking-wider"><ShieldCheck className="w-3 h-3 inline ml-1" /> القائم بالإلغاء</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase tracking-wider"><Clock className="w-3 h-3 inline ml-1" /> الحالة وقتها</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase tracking-wider"><Calendar className="w-3 h-3 inline ml-1" /> التاريخ</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase tracking-wider"><ShieldAlert className="w-3 h-3 inline ml-1" /> إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {cancellations.map((order) => {
                  const cancelData = order.cancellation || {};
                  return (
                    <tr key={order.id} className="hover:bg-white/5 transition-colors group">
                      <td className="p-4">
                        <span className="font-mono text-xs font-bold text-primary group-hover:text-primary-light">
                          #{order.orderNumber?.split('-').pop() || order.orderId}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-white">{order.customerName}</span>
                          <span className="text-[10px] text-text-muted">{order.customerPhone}</span>
                        </div>
                      </td>
                      <td className="p-4 max-w-[250px]">
                        <p className="text-xs text-danger font-medium line-clamp-2">{cancelData.reason || 'غير محدد'}</p>
                      </td>
                      <td className="p-4 text-center">
                        <span className={cn(
                          "px-2 py-1 rounded text-[10px] font-black uppercase",
                          cancelData.cancelledBy === 'customer' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'
                        )}>
                          {cancelData.cancelledBy === 'customer' ? 'العميل' : (cancelData.adminName || 'المدير العام')}
                        </span>
                      </td>
                      <td className="p-4">
                        {getStatusBadge(cancelData.previousStatus || 'unknown')}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <div className="flex flex-col text-left">
                          <span className="text-[11px] font-bold text-white">
                            {format(new Date(cancelData.createdAt || order.updatedAt), 'dd MMMM yyyy', { locale: ar })}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            {format(new Date(cancelData.createdAt || order.updatedAt), 'hh:mm a', { locale: ar })}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                           <button 
                             onClick={() => handleOpenBlockModal(order)}
                             className="p-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all group/btn"
                             title="حظر العميل"
                           >
                             <ShieldAlert className="w-4 h-4" />
                           </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Blacklist Management Modal */}
      <AnimatePresence>
        {isBlacklistModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsBlacklistModalOpen(false)} 
              className="absolute inset-0 bg-background/95 backdrop-blur-2xl" 
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }} 
              className="relative w-full max-w-2xl bg-[#0B0F19] rounded-[40px] border border-white/10 shadow-3xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-8 pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black text-white">القائمة السوداء</h2>
                  <p className="text-text-muted text-xs mt-1">العملاء الذين تم حظرهم من الطلب بسبب كثرة الإلغاءات</p>
                </div>
                <button 
                  onClick={() => setIsBlacklistModalOpen(false)} 
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Search Box */}
              <div className="px-8 py-4 relative">
                <Search className="absolute right-12 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input 
                  type="text" 
                  placeholder="ابحث عن عميل بالاسم أو الهاتف..." 
                  className="w-full h-12 pr-12 pl-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:border-red-500/50 outline-none transition-all"
                  value={blacklistSearch}
                  onChange={(e) => setBlacklistSearch(e.target.value)}
                />
              </div>

              <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-3 scrollbar-hide">
                {isBlacklistLoading ? (
                  <div className="flex flex-col items-center justify-center p-20 opacity-40">
                    <Loader2 className="w-10 h-10 animate-spin mb-4" />
                    <p className="text-sm font-bold">جاري جلب البيانات...</p>
                  </div>
                ) : blacklistedCustomers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-white/5 rounded-3xl opacity-30 text-center">
                    <ShieldOff className="w-12 h-12 mb-4" />
                    <h3 className="font-bold">القائمة السوداء فارغة</h3>
                    <p className="text-xs">لا يوجد عملاء محظورين حالياً.</p>
                  </div>
                ) : (
                  blacklistedCustomers.map((customer) => (
                    <BlacklistRow 
                      key={customer.id} 
                      customer={customer} 
                      unblockingId={unblockingId}
                      confirmUnblockId={confirmUnblockId}
                      setConfirmUnblockId={setConfirmUnblockId}
                      onUnblock={handleUnblock}
                    />
                  ))
                )}
              </div>
              
              <div className="p-8 bg-white/[0.02] border-t border-white/5 text-center">
                 <p className="text-[11px] text-text-muted font-bold">
                   يتم فك الحظر تلقائياً في حال كان الحظر مؤقتاً عبر ميزة <span className="text-primary italic">Lazy Unblock</span> عند محاولة العميل الطلب مجدداً.
                 </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manual Block Modal (CRM Grade) */}
      <AnimatePresence>
        {isBlockModalOpen && targetCustomer && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               onClick={() => setIsBlockModalOpen(false)}
               className="absolute inset-0 bg-background/80 backdrop-blur-md"
             />
             <motion.div
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="relative w-full max-w-lg bg-card border border-white/10 rounded-[32px] shadow-2xl overflow-hidden"
             >
               <div className="p-8 pb-4 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                     <ShieldAlert className="w-5 h-5 text-red-500" />
                   </div>
                   <div>
                     <h3 className="text-xl font-bold text-white">حظر عميل</h3>
                     <p className="text-text-muted text-xs">أنت الآن تقوم بحظر العميل {targetCustomer.name}</p>
                   </div>
                 </div>
                 <button onClick={() => setIsBlockModalOpen(false)} className="text-text-muted hover:text-white transition-colors">
                   <X className="w-6 h-6" />
                 </button>
               </div>

               <form onSubmit={handleBlockSubmit} className="p-8 space-y-6">
                 {/* Severity Level */}
                 <div className="space-y-3">
                   <label className="text-xs font-bold text-text-muted uppercase tracking-wider">مستوى الخطورة (Severity)</label>
                   <div className="grid grid-cols-3 gap-3">
                     {['LOW', 'MEDIUM', 'HIGH'].map(level => {
                       const config = formatRiskSeverity(level);
                       return (
                         <button
                           key={level}
                           type="button"
                           onClick={() => setBlockForm(prev => ({ ...prev, severity: level }))}
                           className={cn(
                             "flex flex-col items-center gap-1 p-3 rounded-2xl border transition-all",
                             blockForm.severity === level 
                               ? `bg-${config.color.split('-')[1]}-500/10 border-${config.color.split('-')[1]}-500/50` 
                               : "bg-white/5 border-white/5 hover:border-white/10"
                           )}
                         >
                           <span className={cn("text-[10px] font-black", config.color)}>{level}</span>
                           <span className="text-[9px] text-text-muted text-center leading-tight">{config.label}</span>
                         </button>
                       );
                     })}
                   </div>
                   <p className="text-[10px] text-text-muted italic">
                      ℹ️ {formatRiskSeverity(blockForm.severity).helper}
                   </p>
                 </div>

                 {/* Duration */}
                 <div className="space-y-3">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">مدة الحظر</label>
                    <select 
                      value={blockForm.durationDays}
                      onChange={(e) => setBlockForm(prev => ({ ...prev, durationDays: e.target.value }))}
                      className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:border-primary/50 outline-none transition-all"
                    >
                      <option value="0" className="bg-background">حظر دائم (Permanent)</option>
                      <option value="7" className="bg-background">7 أيام (مخالفة سلوكية)</option>
                      <option value="30" className="bg-background">30 يوم (إساءة متكررة)</option>
                    </select>
                 </div>

                 {/* Reason */}
                 <div className="space-y-3">
                   <label className="text-xs font-bold text-text-muted uppercase tracking-wider">سبب الحظر (إلزامي)</label>
                   <textarea 
                     required
                     value={blockForm.reason}
                     onChange={(e) => setBlockForm(prev => ({ ...prev, reason: e.target.value }))}
                     placeholder="اشرح سبب الحظر هنا..."
                     className="w-full h-32 p-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:border-primary/50 outline-none transition-all resize-none"
                   />
                 </div>

                 <button 
                   disabled={blockLoading}
                   type="submit"
                   className="w-full py-4 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-black text-sm rounded-2xl shadow-lg shadow-red-500/20 transition-all flex items-center justify-center gap-2"
                 >
                   {blockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                   تأكيد حظر العميل
                 </button>
               </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CancelledOrders;

// Sub-component for each row to safely use Hooks
const BlacklistRow = ({ customer, unblockingId, confirmUnblockId, setConfirmUnblockId, onUnblock }) => {
  const { status, isTemporary, isExpired } = useBlacklistStatus(customer);
  const statusConfig = formatBlacklistStatus(status);

  return (
    <motion.div 
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="group relative flex items-center justify-between p-5 rounded-[24px] bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all duration-500"
    >
      <div className="flex items-center gap-5">
        <div className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500",
          isExpired ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500 group-hover:scale-110"
        )}>
          <User className="w-6 h-6" />
        </div>
        
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-white font-bold text-sm tracking-tight">{customer.name}</h4>
            <span className={cn(
              "px-2 py-0.5 rounded-full text-[9px] font-black border uppercase tracking-tighter",
              statusConfig.color
            )}>
              {statusConfig.label}
            </span>
            {customer.riskScore > 0 && (() => {
               const config = getRiskScoreColor(customer.riskScore);
               return (
                 <span className={cn(
                   "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter border",
                   config.color, config.textColor, config.borderColor
                 )}>
                   {Math.round(customer.riskScore)} - {config.label}
                 </span>
               );
            })()}
          </div>
          
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
             <div className="flex items-center gap-1">
               <TrendingDown className="w-3 h-3" />
               <span className="font-mono">{customer.phone}</span>
             </div>
             <div className="flex items-center gap-1">
                <Clock3 className="w-3 h-3" />
                <span>منذ {format(new Date(customer.blacklistedAt || customer.createdAt), 'dd MMMM', { locale: ar })}</span>
             </div>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="text-left hidden md:block">
          <p className="text-text-muted text-[9px] font-black uppercase tracking-[0.2em] mb-1">المصدر / النوع</p>
          <div className="flex items-center gap-2">
            <span className="text-white text-[10px] font-bold">
              {customer.blacklistSource === 'AUTO' ? 'نظام الحماية' : 'إجراء إداري'}
            </span>
            {isTemporary && (
              <span className="text-amber-500 text-[10px] font-bold flex items-center gap-1">
                 <Clock className="w-3 h-3" />
                 {format(new Date(customer.blacklistExpiresAt), 'HH:mm')}
              </span>
            )}
          </div>
        </div>
        
        {confirmUnblockId === customer.id ? (
          <div className="flex items-center gap-2 animate-in slide-in-from-right duration-300">
            <button 
              disabled={unblockingId === customer.id}
              onClick={() => onUnblock(customer)}
              className="px-5 py-2 rounded-xl bg-emerald-500 text-white text-[11px] font-black hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
            >
              {unblockingId === customer.id ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'تأكيد فك الحظر'}
            </button>
            <button 
              onClick={() => setConfirmUnblockId(null)}
              className="w-9 h-9 rounded-xl bg-white/5 text-white flex items-center justify-center hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button 
            onClick={() => setConfirmUnblockId(customer.id)}
            className="group/btn w-11 h-11 rounded-2xl bg-white/5 border border-white/5 text-text-muted hover:bg-emerald-500/10 hover:text-emerald-500 hover:border-emerald-500/30 transition-all duration-300"
            title="فك الحظر عن العميل"
          >
            <ShieldOff className="w-5 h-5 mx-auto group-hover/btn:scale-110 transition-transform" />
          </button>
        )}
      </div>
    </motion.div>
  );
};
