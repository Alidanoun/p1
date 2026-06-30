import { useState, useEffect } from 'react';
import { Plus, Trash2, Tag, Percent, Banknote, X, Check, ToggleLeft, ToggleRight, Package } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import Header from '../components/Header';
import { cn } from '../lib/utils';
import Switch from '../components/Switch';
import api, { unwrap } from '../api/client';
import ConfirmationModal from '../components/ConfirmationModal';

const DISCOUNT_TYPES = [
  { value: 'PERCENTAGE', label: 'نسبة مئوية (%)', icon: Percent },
  { value: 'FIXED_AMOUNT', label: 'مبلغ ثابت (د.أ)', icon: Banknote },
  { value: 'FREE_SHIPPING', label: 'شحن مجاني', icon: Package },
];

const TARGET_SCOPES = [
  { value: 'GLOBAL', label: 'جميع الطلبات' },
  { value: 'BRANCH_SPECIFIC', label: 'فرع محدد' },
  { value: 'ITEM_SPECIFIC', label: 'صنف محدد' },
  { value: 'CUSTOMER_TIER', label: 'فئة عميل (Gold/Platinum)' },
  { value: 'NEW_CUSTOMER', label: 'العملاء الجدد فقط' },
];

const today = () => new Date().toISOString().split('T')[0];
const nextMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
};

const EMPTY_FORM = {
  title: '',
  description: '',
  type: 'PERCENTAGE',
  value: '',
  minOrderValue: '0',
  maxDiscount: '',
  targetScope: 'GLOBAL',
  targetId: '',
  couponCode: '',
  globalUsageLimit: '',
  userUsageLimit: '1',
  startDate: today(),
  endDate: nextMonth(),
  isActive: true,
};

const DiscountsManager = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const data = unwrap(await api.get('/discounts/campaigns'));
      setCampaigns(Array.isArray(data) ? data : []);
    } catch {
      toast.error('فشل تحميل العروض');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const handleOpenModal = () => {
    setFormData(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const promise = api.post('/discounts/campaigns', formData);
    toast.promise(promise, {
      loading: 'جاري إنشاء العرض...',
      success: () => {
        fetchCampaigns();
        setIsModalOpen(false);
        return 'تم إنشاء العرض بنجاح ✅';
      },
      error: (err) => err?.response?.data?.error?.message || 'فشل إنشاء العرض',
    });
    try {
      await promise;
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (camp) => {
    const newState = !camp.isActive;
    setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, isActive: newState } : c));
    try {
      await api.patch(`/discounts/campaigns/${camp.id}/status`, { isActive: newState });
      toast.success(newState ? 'تم تفعيل العرض' : 'تم إيقاف العرض');
    } catch {
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, isActive: !newState } : c));
      toast.error('فشل تحديث الحالة');
    }
  };

  const handleDelete = (id, title) => {
    setConfirmConfig({
      title: 'حذف العرض',
      message: `هل أنت متأكد من حذف عرض "${title}"؟ سيتم حذف الكوبون المرتبط به نهائياً.`,
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/discounts/campaigns/${id}`);
          setCampaigns(prev => prev.filter(c => c.id !== id));
          toast.success('تم حذف العرض بنجاح');
        } catch {
          toast.error('فشل الحذف');
        } finally {
          setConfirmConfig(null);
        }
      },
    });
  };

  const getTypeLabel = (type) => DISCOUNT_TYPES.find(t => t.value === type)?.label || type;
  const getScopeLabel = (scope) => TARGET_SCOPES.find(s => s.value === scope)?.label || scope;
  const isExpired = (endDate) => new Date(endDate) < new Date();

  const activeCount = campaigns.filter(c => c.isActive && !isExpired(c.endDate)).length;
  const totalUsed = campaigns.reduce((sum, c) => sum + (c.usedCount || 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-10">
        <Header
          title="إدارة الخصومات والعروض"
          subtitle="أنشئ وتحكم في كوبونات الخصم والعروض الترويجية لعملائك"
        />
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleOpenModal}
          className="glass-button flex items-center justify-center gap-2 h-14 px-8 group"
        >
          <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
          <span>إنشاء عرض جديد</span>
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'إجمالي العروض', value: campaigns.length, icon: Tag, color: 'primary' },
          { label: 'العروض النشطة', value: activeCount, icon: ToggleRight, color: 'emerald' },
          { label: 'إجمالي الاستخدامات', value: totalUsed, icon: Check, color: 'amber' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass-card p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl bg-${color}-500/10 flex items-center justify-center text-${color}-500`}>
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-text-muted font-bold uppercase tracking-widest">{label}</p>
              <p className="text-2xl font-black text-white">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['العرض', 'كود الكوبون', 'النوع والقيمة', 'الاستخدام', 'النطاق', 'تاريخ الانتهاء', 'الحالة', ''].map(h => (
                  <th key={h} className="px-6 py-4 text-right text-[10px] font-black text-text-muted uppercase tracking-widest">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-16 text-center text-text-muted">جاري التحميل...</td></tr>
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-3 text-text-muted">
                        <Tag className="w-12 h-12 opacity-20" />
                        <p className="text-sm font-bold">لا توجد عروض بعد</p>
                        <p className="text-xs">ابدأ بإنشاء أول عرض ترويجي لعملائك</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  campaigns.map((camp, i) => {
                    const expired = isExpired(camp.endDate);
                    return (
                      <motion.tr
                        key={camp.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Title */}
                        <td className="px-6 py-5">
                          <p className="font-bold text-white">{camp.title}</p>
                          {camp.description && (
                            <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{camp.description}</p>
                          )}
                        </td>

                        {/* Coupon Code */}
                        <td className="px-6 py-5">
                          <span className="px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-black tracking-widest font-mono">
                            {camp.couponCode}
                          </span>
                        </td>

                        {/* Type */}
                        <td className="px-6 py-5">
                          <p className="text-sm font-bold text-white">
                            {camp.type === 'PERCENTAGE' ? `${camp.value}%` :
                             camp.type === 'FIXED_AMOUNT' ? `${camp.value} د.أ` : 'شحن مجاني'}
                          </p>
                          <p className="text-[10px] text-text-muted mt-0.5">{getTypeLabel(camp.type)}</p>
                        </td>

                        {/* Usage */}
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-white/5 rounded-full h-1.5 max-w-[80px]">
                              {camp.globalUsageLimit && (
                                <div
                                  className="bg-primary h-full rounded-full transition-all"
                                  style={{ width: `${Math.min((camp.usedCount / camp.globalUsageLimit) * 100, 100)}%` }}
                                />
                              )}
                            </div>
                            <span className="text-sm font-bold text-white font-mono">
                              {camp.usedCount} / {camp.globalUsageLimit ?? '∞'}
                            </span>
                          </div>
                        </td>

                        {/* Scope */}
                        <td className="px-6 py-5">
                          <span className="text-xs text-text-muted">{getScopeLabel(camp.targetScope)}</span>
                        </td>

                        {/* End Date */}
                        <td className="px-6 py-5">
                          <span className={cn(
                            "text-sm font-bold",
                            expired ? "text-danger" : "text-text-muted"
                          )}>
                            {new Date(camp.endDate).toLocaleDateString('ar-JO')}
                            {expired && <span className="block text-[10px]">منتهي</span>}
                          </span>
                        </td>

                        {/* Status Toggle */}
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={camp.isActive}
                              onChange={() => handleToggle(camp)}
                              disabled={expired}
                            />
                            <span className={cn(
                              "text-[10px] font-black uppercase",
                              camp.isActive && !expired ? "text-emerald-500" : "text-text-muted"
                            )}>
                              {expired ? 'منتهي' : camp.isActive ? 'نشط' : 'متوقف'}
                            </span>
                          </div>
                        </td>

                        {/* Delete */}
                        <td className="px-6 py-5">
                          <button
                            onClick={() => handleDelete(camp.id, camp.title)}
                            className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:text-danger hover:bg-danger/10 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Campaign Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-background/90 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0B0F19] rounded-[40px] border border-white/10 shadow-3xl overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="p-8 md:p-10">
                {/* Modal Header */}
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-2xl font-black text-white">إنشاء عرض جديد</h2>
                    <p className="text-text-muted text-xs mt-1">أدخل بيانات الكوبون وشروط الخصم</p>
                  </div>
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
                  >
                    <X className="w-6 h-6 text-white" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Title */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted px-2">عنوان العرض *</label>
                    <input
                      required type="text" placeholder="مثلاً: عرض الصيف"
                      className="glass-input h-14 px-6 text-base font-bold w-full"
                      value={formData.title}
                      onChange={e => setFormData({ ...formData, title: e.target.value })}
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted px-2">الوصف (اختياري)</label>
                    <input
                      type="text" placeholder="وصف مختصر للعرض"
                      className="glass-input h-12 px-6 w-full"
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                    />
                  </div>

                  {/* Coupon Code */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted px-2">كود الكوبون * (بالأحرف الإنجليزية الكبيرة)</label>
                    <input
                      required type="text" placeholder="مثلاً: SUMMER2025" dir="ltr"
                      className="glass-input h-14 px-6 text-lg font-black tracking-widest text-primary w-full font-mono"
                      value={formData.couponCode}
                      onChange={e => setFormData({ ...formData, couponCode: e.target.value.toUpperCase().replace(/\s/g, '') })}
                    />
                  </div>

                  {/* Type + Value */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">نوع الخصم *</label>
                      <select
                        required
                        className="glass-input h-14 px-6 w-full cursor-pointer"
                        value={formData.type}
                        onChange={e => setFormData({ ...formData, type: e.target.value })}
                      >
                        {DISCOUNT_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">
                        {formData.type === 'PERCENTAGE' ? 'النسبة (%)' : formData.type === 'FIXED_AMOUNT' ? 'المبلغ (د.أ)' : 'لا يوجد قيمة'}
                      </label>
                      <input
                        type="number" step="0.01" min="0" placeholder="0"
                        disabled={formData.type === 'FREE_SHIPPING'}
                        className="glass-input h-14 px-6 font-mono font-bold w-full disabled:opacity-40"
                        value={formData.value}
                        onChange={e => setFormData({ ...formData, value: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Min Order + Max Discount */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">الحد الأدنى للطلب (د.أ)</label>
                      <input
                        type="number" step="0.01" min="0" placeholder="0.00"
                        className="glass-input h-14 px-6 font-mono font-bold w-full"
                        value={formData.minOrderValue}
                        onChange={e => setFormData({ ...formData, minOrderValue: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">الحد الأقصى للخصم (د.أ) - اختياري</label>
                      <input
                        type="number" step="0.01" min="0" placeholder="بلا حد"
                        disabled={formData.type !== 'PERCENTAGE'}
                        className="glass-input h-14 px-6 font-mono font-bold w-full disabled:opacity-40"
                        value={formData.maxDiscount}
                        onChange={e => setFormData({ ...formData, maxDiscount: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Usage Limits */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">الحد الأقصى الكلي للاستخدام (اتركه فارغاً = بلا حد)</label>
                      <input
                        type="number" min="1" placeholder="∞ بلا حد"
                        className="glass-input h-14 px-6 font-mono font-bold w-full"
                        value={formData.globalUsageLimit}
                        onChange={e => setFormData({ ...formData, globalUsageLimit: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">حد الاستخدام لكل عميل</label>
                      <input
                        required type="number" min="1" placeholder="1"
                        className="glass-input h-14 px-6 font-mono font-bold w-full"
                        value={formData.userUsageLimit}
                        onChange={e => setFormData({ ...formData, userUsageLimit: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Target Scope */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted px-2">نطاق الاستهداف</label>
                    <select
                      className="glass-input h-14 px-6 w-full cursor-pointer"
                      value={formData.targetScope}
                      onChange={e => setFormData({ ...formData, targetScope: e.target.value })}
                    >
                      {TARGET_SCOPES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">تاريخ البدء *</label>
                      <input
                        required type="date"
                        className="glass-input h-14 px-6 font-mono w-full"
                        value={formData.startDate}
                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">تاريخ الانتهاء *</label>
                      <input
                        required type="date"
                        className="glass-input h-14 px-6 font-mono w-full"
                        value={formData.endDate}
                        onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Active Toggle */}
                  <div className="flex items-center gap-4 px-2 py-3 rounded-2xl bg-white/5 border border-white/5">
                    <span className="text-sm font-bold text-white flex-1">تفعيل العرض فوراً</span>
                    <Switch
                      checked={formData.isActive}
                      onChange={val => setFormData({ ...formData, isActive: val })}
                    />
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-16 bg-primary text-white text-lg font-black rounded-3xl shadow-2xl flex items-center justify-center gap-3 hover:shadow-primary/20 transition-all mt-2 disabled:opacity-60"
                  >
                    <Tag className="w-6 h-6" />
                    <span>اعتماد العرض</span>
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!confirmConfig}
        title={confirmConfig?.title}
        message={confirmConfig?.message}
        type={confirmConfig?.type}
        onConfirm={confirmConfig?.onConfirm}
        onCancel={() => setConfirmConfig(null)}
        confirmText="حذف"
        cancelText="تراجع"
      />
    </div>
  );
};

export default DiscountsManager;
