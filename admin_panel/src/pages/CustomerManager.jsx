import { useState, useEffect, useCallback } from 'react';
import { 
  User, ShieldAlert, ShieldOff, Search, Loader2, X, RefreshCw, 
  Clock, AlertTriangle, TrendingDown, Calendar, ShieldCheck, History
} from 'lucide-react';
import Header from '../components/Header';
import api, { unwrap } from '../api/client';
import Customer360 from '../components/Customer360';
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

const CustomerManager = () => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [blacklistCount, setBlacklistCount] = useState(0);

  // Pagination
  const [page, setPage] = useState(0);
  const limit = 10;
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  // Unblock confirmations
  const [confirmUnblockId, setConfirmUnblockId] = useState(null);
  const [unblockingId, setUnblockingId] = useState(null);

  // Manual block form
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockForm, setBlockForm] = useState({
    customerId: '',
    reason: '',
    severity: 'MEDIUM',
    durationDays: '0'
  });

  const [selected360CustomerId, setSelected360CustomerId] = useState(null);

  const fetchBlacklistCount = useCallback(async () => {
    try {
      const response = await api.get('/customers/blacklist/count');
      setBlacklistCount(response.data?.data?.count || response.data?.count || 0);
    } catch (err) {
      console.warn('Failed to fetch blacklist count:', err);
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const skip = page * limit;
      const response = unwrap(
        await api.get(`/customers/blacklisted?search=${debouncedSearch}&limit=${limit}&skip=${skip}`)
      );
      
      const list = response?.customers || [];
      setCustomers(list);
      setTotal(response?.pagination?.total || 0);
      setHasMore(response?.pagination?.hasMore || false);
    } catch (err) {
      console.error('Failed to fetch blacklisted customers:', err);
      toast.error('حدث خطأ أثناء جلب قائمة العملاء المحظورين');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    fetchCustomers();
    fetchBlacklistCount();
  }, [fetchCustomers, fetchBlacklistCount]);

  const handleUnblock = async (customer) => {
    const originalList = [...customers];
    const id = customer.id;
    
    setUnblockingId(id);
    // Optimistic Update
    setCustomers(prev => prev.filter(c => c.id !== id));
    setConfirmUnblockId(null);

    try {
      await api.patch(`/customers/${id}/unblock`, { 
        reason: 'تم إلغاء الحظر يدوياً من لوحة التحكم' 
      });
      toast.success(`تم فك الحظر عن العميل ${customer.name} بنجاح`);
      fetchBlacklistCount();
    } catch (err) {
      console.error('Unblock error:', err);
      toast.error(err.response?.data?.error || 'فشل إلغاء الحظر عن العميل');
      // Rollback
      setCustomers(originalList);
    } finally {
      setUnblockingId(null);
    }
  };

  const handleBlockSubmit = async (e) => {
    e.preventDefault();
    if (!blockForm.customerId || !blockForm.reason) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    setBlockLoading(true);
    try {
      const { data } = await api.patch(`/customers/${blockForm.customerId}/block`, {
        reason: blockForm.reason,
        reasonCode: 'MANUAL_ADMIN',
        severity: blockForm.severity,
        durationDays: parseInt(blockForm.durationDays)
      });

      toast.success('تم حظر العميل بنجاح');
      setIsBlockModalOpen(false);
      setBlockForm({
        customerId: '',
        reason: '',
        severity: 'MEDIUM',
        durationDays: '0'
      });
      fetchCustomers();
      fetchBlacklistCount();
    } catch (err) {
      console.error('Block error:', err);
      toast.error(err.response?.data?.error || 'فشل حظر العميل. تحقق من المعرّف (ID)');
    } finally {
      setBlockLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <Header 
          title="إدارة العملاء والحد من المخاطر" 
          subtitle="إدارة القائمة السوداء، وفك حظر العملاء، ومراقبة مستوى خطورة الحسابات" 
        />
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsBlockModalOpen(true)}
            className="flex items-center gap-2 px-5 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold text-xs shadow-lg shadow-red-500/20 transition-all duration-300"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>حظر عميل يدويًا</span>
          </button>
          
          <button 
            onClick={() => { fetchCustomers(); fetchBlacklistCount(); }}
            className="p-3 rounded-xl bg-card/60 border border-white/5 text-text-muted hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 border-r-4 border-r-red-500 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-text-muted mb-1">العملاء المحظورين حالياً</p>
            <h3 className="text-3xl font-black text-white">{blacklistCount}</h3>
          </div>
          <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-red-500" />
          </div>
        </div>

        <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 border-r-4 border-r-emerald-500 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-text-muted mb-1">إجمالي الحسابات المفكوك حظرها</p>
            <h3 className="text-3xl font-black text-white">{total}</h3>
            <p className="text-[9px] text-text-muted mt-1">تاريخي في سجلات البحث</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Search & List */}
      <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="font-bold text-white text-lg">سجل القائمة السوداء والعملاء المحظورين</h3>
          
          <div className="relative w-full md:w-80">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input 
              type="text" 
              placeholder="البحث بالاسم أو الهاتف بدقة..." 
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full h-11 pr-11 pl-4 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:border-red-500/50 outline-none transition-all"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-20 flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-text-muted text-sm animate-pulse">جاري جلب قائمة العملاء...</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-20 flex flex-col items-center text-center opacity-40">
            <User className="w-16 h-16 mb-4 text-text-muted" />
            <h3 className="text-lg font-bold text-white mb-1">لا يوجد عملاء مطابقين</h3>
            <p className="text-xs">تأكد من إدخال الاسم أو الهاتف بدقة كاملة.</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {customers.map((customer) => (
              <BlacklistRow 
                key={customer.id} 
                customer={customer} 
                unblockingId={unblockingId}
                confirmUnblockId={confirmUnblockId}
                setConfirmUnblockId={setConfirmUnblockId}
                onUnblock={handleUnblock}
                onView360={setSelected360CustomerId}
              />
            ))}

            {/* Pagination Controls */}
            {(page > 0 || hasMore) && (
              <div className="flex items-center justify-center gap-4 mt-8 pt-4 border-t border-white/5">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(prev => Math.max(0, prev - 1))}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all"
                >
                  السابق
                </button>
                <span className="text-xs text-text-muted">الصفحة {page + 1}</span>
                <button
                  disabled={!hasMore}
                  onClick={() => setPage(prev => prev + 1)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all"
                >
                  التالي
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual Block Modal */}
      <AnimatePresence>
        {isBlockModalOpen && (
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
              className="relative w-full max-w-lg bg-[#0E131F] border border-white/10 rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 pb-4 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                    <ShieldAlert className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white font-sans">حظر عميل يدوياً</h3>
                    <p className="text-text-muted text-[10px]">حظر حساب العميل عن طريق معرفه (ID)</p>
                  </div>
                </div>
                <button onClick={() => setIsBlockModalOpen(false)} className="text-text-muted hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleBlockSubmit} className="p-8 space-y-6">
                {/* Customer ID */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-wider">معرّف العميل الرقمي (Customer ID)</label>
                  <input 
                    type="number" 
                    required
                    placeholder="مثال: 42"
                    value={blockForm.customerId}
                    onChange={(e) => setBlockForm(prev => ({ ...prev, customerId: e.target.value }))}
                    className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:border-primary/50 outline-none transition-all"
                  />
                </div>

                {/* Severity Level */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-wider">مستوى خطورة الحظر</label>
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
                              ? `bg-red-500/10 border-red-500/50` 
                              : "bg-white/5 border-white/5 hover:border-white/10"
                          )}
                        >
                          <span className={cn("text-[10px] font-black text-red-500")}>{level}</span>
                          <span className="text-[9px] text-text-muted text-center leading-tight">{config.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Duration */}
                <div className="space-y-3">
                   <label className="text-xs font-bold text-text-muted uppercase tracking-wider">مدة الحظر</label>
                   <select 
                     value={blockForm.durationDays}
                     onChange={(e) => setBlockForm(prev => ({ ...prev, durationDays: e.target.value }))}
                     className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:border-primary/50 outline-none transition-all"
                   >
                     <option value="0" className="bg-[#0E131F]">حظر دائم (Permanent)</option>
                     <option value="7" className="bg-[#0E131F]">7 أيام (مخالفة سلوكية)</option>
                     <option value="30" className="bg-[#0E131F]">30 يوم (إساءة متكررة)</option>
                   </select>
                </div>

                {/* Reason */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-wider">سبب الحظر</label>
                  <textarea 
                    required
                    value={blockForm.reason}
                    onChange={(e) => setBlockForm(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="اشرح سبب الحظر لتوثيقه في سجل التدقيق..."
                    className="w-full h-24 p-4 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:border-primary/50 outline-none transition-all resize-none"
                  />
                </div>

                <button 
                  disabled={blockLoading}
                  type="submit"
                  className="w-full py-4 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-black text-sm rounded-2xl shadow-lg shadow-red-500/20 transition-all flex items-center justify-center gap-2"
                >
                  {blockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                  حظر العميل الآن
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <Customer360 
        customerId={selected360CustomerId} 
        isOpen={selected360CustomerId !== null} 
        onClose={() => setSelected360CustomerId(null)} 
      />
    </div>
  );
};

// Row Component
const BlacklistRow = ({ customer, unblockingId, confirmUnblockId, setConfirmUnblockId, onUnblock, onView360 }) => {
  const { status, isTemporary } = useBlacklistStatus(customer);
  const statusConfig = formatBlacklistStatus(status);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all duration-300"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500">
          <User className="w-5 h-5" />
        </div>
        
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-white font-bold text-sm">{customer.name}</h4>
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
             <span>الهاتف: <strong className="font-mono text-white">{customer.phone}</strong></span>
             {customer.blacklistedAt && (
               <span>تاريخ الحظر: {format(new Date(customer.blacklistedAt), 'dd MMMM yyyy', { locale: ar })}</span>
             )}
          </div>
          {customer.blacklistReason && (
            <p className="text-[10px] text-red-400/80 mt-1 font-medium">السبب: {customer.blacklistReason}</p>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <button 
          onClick={() => onView360(customer.id)}
          className="group/btn w-10 h-10 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all duration-300"
          title="عرض بروفايل العميل 360°"
        >
          <History className="w-4 h-4 mx-auto group-hover/btn:scale-110 transition-transform" />
        </button>

        <div className="text-left hidden md:block">
          <p className="text-text-muted text-[8px] font-black uppercase mb-1">نوع الحظر</p>
          <div className="flex items-center gap-2">
            <span className="text-white text-[10px] font-bold">
              {customer.blacklistSource === 'AUTO' ? 'تلقائي (حماية)' : 'إداري'}
            </span>
            {isTemporary && customer.blacklistExpiresAt && (
              <span className="text-amber-500 text-[10px] font-bold">
                 مؤقت حتى {format(new Date(customer.blacklistExpiresAt), 'dd MMM HH:mm', { locale: ar })}
              </span>
            )}
          </div>
        </div>
        
        {confirmUnblockId === customer.id ? (
          <div className="flex items-center gap-2">
            <button 
              disabled={unblockingId === customer.id}
              onClick={() => onUnblock(customer)}
              className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-[10px] font-black hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
            >
              {unblockingId === customer.id ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'تأكيد فك الحظر'}
            </button>
            <button 
              onClick={() => setConfirmUnblockId(null)}
              className="w-8 h-8 rounded-lg bg-white/5 text-white flex items-center justify-center hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button 
            onClick={() => setConfirmUnblockId(customer.id)}
            className="group/btn w-10 h-10 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:bg-emerald-500/10 hover:text-emerald-500 hover:border-emerald-500/30 transition-all duration-300"
            title="فك الحظر عن العميل"
          >
            <ShieldOff className="w-4 h-4 mx-auto group-hover/btn:scale-110 transition-transform" />
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default CustomerManager;
