import { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle, XCircle, Clock, Info, MessageSquare, TrendingUp, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { formatCurrencyArabic } from '../lib/formatters';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

/**
 * 🛰️ Financial Approval Widget (Control Tower)
 */
const FinancialApprovalWidget = () => {
  const [approvals, setApprovals] = useState([]);
  const [stats, setStats] = useState({ pendingCount: 0, highRiskCount: 0, attentionRequired: false });
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  const fetchApprovals = async () => {
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/financial/approvals/pending'),
        api.get('/financial/approvals/stats')
      ]);
      setApprovals(listRes.data.data || []);
      setStats(statsRes.data.data || { pendingCount: 0, highRiskCount: 0, attentionRequired: false });
    } catch (error) {
      console.error('Financial approvals fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (id, action, reason = '') => {
    const approval = approvals.find(a => a.id === id);
    const amount = formatCurrencyArabic(approval?.payload?.delta?.absoluteDifference || 0);
    
    // 🛡️ Human Error Layer: Explicit Confirmation
    const confirmMsg = action === 'approve' 
      ? `⚠️ هل أنت متأكد من الموافقة؟ سيتم تنفيذ عملية ${approval.operationType} بقيمة ${amount}. لا يمكن التراجع عن هذا الإجراء.`
      : `⚠️ هل أنت متأكد من رفض هذه العملية بقيمة ${amount}؟`;

    if (!window.confirm(confirmMsg)) return;

    if (action === 'reject' && !reason) {
      const userReason = window.prompt('يرجى إدخال سبب الرفض (إلزامي):');
      if (!userReason) return;
      reason = userReason;
    }

    setProcessingId(id);
    try {
      await api.post(`/financial/approvals/${id}/${action}`, { reason });
      toast.success(action === 'approve' ? 'تمت الموافقة المالية بنجاح' : 'تم رفض العملية المالية');
      fetchApprovals();
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشلت العملية');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading && approvals.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* 🚨 Smart Alert Banner */}
      <AnimatePresence>
        {stats.attentionRequired && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-3 text-red-500 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center animate-pulse">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold">Attention Required</p>
                <p className="text-[10px] opacity-80">يوجد {stats.highRiskCount} عمليات عالية الخطورة بانتظار قرارك</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glass-panel overflow-hidden flex flex-col">
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <h3 className="text-sm font-bold text-white flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <ShieldAlert className="w-3.5 h-3.5 text-primary" />
            </div>
            مركز الموافقات المالية
            {approvals.length > 0 && (
              <span className="bg-primary/20 text-primary text-[10px] px-2 py-0.5 rounded-full">
                {approvals.length}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-4 text-[10px] font-bold text-text-muted">
             <span>Pending: {stats.pendingCount}</span>
             <TrendingUp className="w-3 h-3 opacity-30" />
          </div>
        </div>

        <div className="p-2 space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar-slim">
          {approvals.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center opacity-20">
               <CheckCircle className="w-8 h-8 mb-2" />
               <p className="text-[10px] font-bold uppercase tracking-widest">لا توجد عمليات معلقة</p>
            </div>
          ) : (
            approvals.map((app) => (
              <motion.div 
                key={app.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/[0.03] border border-white/5 rounded-xl p-4 hover:bg-white/[0.05] transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      app.riskLevel === 'HIGH' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                      app.riskLevel === 'MEDIUM' ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" :
                      "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    )} />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-white">{app.operationType}</h4>
                        <span className={cn(
                          "text-[8px] font-black px-1.5 py-0.5 rounded border uppercase",
                          app.riskLevel === 'HIGH' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                          app.riskLevel === 'MEDIUM' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                          "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                        )}>
                          {app.riskLevel}
                        </span>
                      </div>
                      <p className="text-[9px] text-text-muted font-mono mt-0.5">ID: {app.id.slice(0, 8)}</p>
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-black text-white font-mono">{formatCurrencyArabic(app.payload?.delta?.absoluteDifference || 0)}</p>
                    <div className="flex items-center gap-1 justify-end mt-1 text-[9px] text-text-muted">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(app.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3 bg-black/20 p-2 rounded-lg border border-white/5">
                   <div className="text-right">
                      <p className="text-[8px] font-bold text-text-muted uppercase mb-0.5">بواسطة</p>
                      <p className="text-[10px] text-white truncate">{app.requestedByRole.toUpperCase()}</p>
                   </div>
                   <div className="text-left">
                      <p className="text-[8px] font-bold text-text-muted uppercase mb-0.5">الفرع</p>
                      <p className="text-[10px] text-white truncate">{app.branchId?.slice(0, 8) || 'الرئيسي'}</p>
                   </div>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    disabled={processingId === app.id}
                    onClick={() => handleAction(app.id, 'approve')}
                    className="flex-1 py-2 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white border border-emerald-500/20 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle className="w-3 h-3" />
                    موافقة
                  </button>
                  <button 
                    disabled={processingId === app.id}
                    onClick={() => handleAction(app.id, 'reject')}
                    className="flex-1 py-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1.5"
                  >
                    <XCircle className="w-3 h-3" />
                    رفض
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </div>

        <div className="p-3 bg-black/10 border-t border-white/5 text-center">
           <button 
             onClick={fetchApprovals}
             className="text-[9px] font-bold text-primary flex items-center gap-1.5 mx-auto opacity-60 hover:opacity-100 transition-opacity"
           >
              تحديث البيانات <TrendingUp className="w-3 h-3" />
           </button>
        </div>
      </div>
    </div>
  );
};

export default FinancialApprovalWidget;
