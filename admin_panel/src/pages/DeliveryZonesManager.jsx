import { useState, useEffect } from 'react';
import { 
  Plus, Edit2, Trash2, Search, Check, X, 
  MapPin, DollarSign, ArrowUpDown, Info, AlertCircle
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import Header from '../components/Header';
import { cn } from '../lib/utils';
import Switch from '../components/Switch';
import api, { unwrap } from '../api/client';

const DeliveryZonesManager = () => {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [formData, setFormData] = useState({
    nameAr: '',
    nameEn: '',
    fee: '',
    minOrder: '',
    isActive: true,
    sortOrder: 0
  });

  useEffect(() => {
    fetchZones();
  }, []);

  const fetchZones = async () => {
    setLoading(true);
    try {
      const data = unwrap(await api.get('/delivery-zones')) || [];
      setZones(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error('حدث خطأ أثناء تحميل مناطق التوصيل');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (zone = null) => {
    if (zone) {
      setEditingId(zone.id);
      setFormData({
        nameAr: zone.nameAr,
        nameEn: zone.nameEn || '',
        fee: zone.fee.toString(),
        minOrder: zone.minOrder ? zone.minOrder.toString() : '',
        isActive: zone.isActive,
        sortOrder: zone.sortOrder
      });
    } else {
      setEditingId(null);
      setFormData({
        nameAr: '',
        nameEn: '',
        fee: '',
        minOrder: '',
        isActive: true,
        sortOrder: zones.length > 0 ? Math.max(...zones.map(z => z.sortOrder)) + 1 : 1
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!formData.nameAr.trim()) {
      return toast.error('اسم المنطقة بالعربي مطلوب');
    }
    if (isNaN(parseFloat(formData.fee)) || parseFloat(formData.fee) < 0) {
      return toast.error('سعر التوصيل يجب أن يكون رقم موجب');
    }

    const payload = {
      ...formData,
      fee: parseFloat(formData.fee),
      minOrder: formData.minOrder ? parseFloat(formData.minOrder) : null,
      sortOrder: parseInt(formData.sortOrder) || 0
    };

    try {
      const promise = editingId
        ? api.put(`/delivery-zones/${editingId}`, payload)
        : api.post('/delivery-zones', payload);

      toast.promise(promise, {
        loading: 'جاري الحفظ...',
        success: (res) => {
          fetchZones();
          setIsModalOpen(false);
          return editingId ? 'تم تحديث المنطقة بنجاح' : 'تم إضافة المنطقة بنجاح';
        },
        error: (err) => err.response?.data?.error || 'فشل في حفظ المنطقة'
      });
    } catch (error) {
      console.error('Submit delivery zone error:', error);
    }
  };

  const handleDelete = async (id, name) => {
    if (window.confirm(`هل أنت متأكد من حذف منطقة "${name}"؟`)) {
      try {
        const promise = api.delete(`/delivery-zones/${id}`);
        toast.promise(promise, {
          loading: 'جاري الحذف...',
          success: () => {
            setZones(zones.filter(z => z.id !== id));
            return 'تم حذف المنطقة بنجاح';
          },
          error: (err) => err.response?.data?.error || 'فشل في حذف المنطقة'
        });
      } catch (error) {
        console.error('Delete delivery zone error:', error);
      }
    }
  };

  const toggleActive = async (zone) => {
    const newState = !zone.isActive;
    const zoneId = zone.id;
    
    setUpdatingId(zoneId);
    // Optimistic UI update
    setZones(prev => prev.map(z => z.id === zoneId ? { ...z, isActive: newState } : z));
    
    try {
      await api.put(`/delivery-zones/${zoneId}`, { isActive: newState });
      toast.success(newState ? `تم تفعيل منطقة ${zone.nameAr}` : `تم إيقاف منطقة ${zone.nameAr}`);
    } catch (error) {
      // Revert on failure
      setZones(prev => prev.map(z => z.id === zoneId ? { ...z, isActive: !newState } : z));
      toast.error('فشل تحديث حالة المنطقة');
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredZones = zones.filter(zone => 
    zone.nameAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (zone.nameEn && zone.nameEn.toLowerCase().includes(searchQuery.toLowerCase()))
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-10">
        <Header 
          title="إدارة مناطق التوصيل" 
          subtitle="تحكم في مناطق التغطية، أسعار التوصيل، والحد الأدنى للطلبات" 
        />
        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => handleOpenModal()} 
          className="glass-button flex items-center justify-center gap-2 h-14 px-8 group"
        >
          <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
          <span>إضافة منطقة جديدة</span>
        </motion.button>
      </div>

      {/* Global Stats bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-text-muted font-bold uppercase tracking-widest">إجمالي المناطق</p>
            <p className="text-2xl font-black text-white">{zones.length}</p>
          </div>
        </div>
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <Check className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-text-muted font-bold uppercase tracking-widest">المناطق النشطة</p>
            <p className="text-2xl font-black text-white">{zones.filter(z => z.isActive).length}</p>
          </div>
        </div>
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-text-muted font-bold uppercase tracking-widest">متوسط سعر التوصيل</p>
            <p className="text-2xl font-black text-white">
              {zones.length > 0 ? (zones.reduce((acc, z) => acc + parseFloat(z.fee), 0) / zones.length).toFixed(2) : '0.00'}
            </p>
          </div>
        </div>
        <div className="relative group w-full h-full">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted group-focus-within:text-primary transition-colors" />
          <input
            type="text"
            placeholder="ابحث عن منطقة..."
            className="glass-input h-full pr-12 text-sm bg-card/40 border-white/5 focus:bg-card/60"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table Section */}
      <div className="glass-card overflow-hidden border-white/5 rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/5">
                <th className="px-6 py-5 text-xs font-black text-text-muted uppercase tracking-widest">الترتيب</th>
                <th className="px-6 py-5 text-xs font-black text-text-muted uppercase tracking-widest">المنطقة</th>
                <th className="px-6 py-5 text-xs font-black text-text-muted uppercase tracking-widest">سعر التوصيل</th>
                <th className="px-6 py-5 text-xs font-black text-text-muted uppercase tracking-widest">الحد الأدنى للطلب</th>
                <th className="px-6 py-5 text-xs font-black text-text-muted uppercase tracking-widest">الحالة</th>
                <th className="px-6 py-5 text-xs font-black text-text-muted uppercase tracking-widest text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-6 py-20 text-center text-text-muted italic opacity-50">جاري تحميل البيانات...</td>
                </tr>
              ) : filteredZones.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-20 text-center text-text-muted italic opacity-50">لا توجد مناطق لعرضها</td>
                </tr>
              ) : filteredZones.map((zone) => (
                <motion.tr 
                  layout
                  key={zone.id}
                  className={cn(
                    "group transition-colors",
                    zone.isActive ? "hover:bg-white/[0.02]" : "bg-red-500/[0.02] opacity-70"
                  )}
                >
                  <td className="px-6 py-5 font-mono text-sm text-text-muted">#{zone.sortOrder}</td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-bold text-white text-lg">{zone.nameAr}</span>
                      <span className="text-xs text-text-muted font-medium">{zone.nameEn || '---'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 font-bold text-white font-mono">{parseFloat(zone.fee).toFixed(2)} JOD</td>
                  <td className="px-6 py-5">
                    {zone.minOrder ? (
                      <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-500 text-xs font-bold border border-amber-500/20">
                        {parseFloat(zone.minOrder).toFixed(2)} JOD
                      </span>
                    ) : (
                      <span className="text-text-muted text-xs italic">بدون حد أدنى</span>
                    )}
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <Switch 
                        checked={zone.isActive} 
                        onChange={() => toggleActive(zone)}
                        disabled={updatingId === zone.id}
                      />
                      <span className={cn(
                        "text-[10px] font-black uppercase tracking-tighter",
                        zone.isActive ? "text-emerald-500" : "text-text-muted"
                      )}>
                        {zone.isActive ? 'نشطة' : 'متوقفة'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center justify-start gap-2">
                      <button 
                        onClick={() => handleOpenModal(zone)}
                        className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:text-white hover:bg-white/10 transition-all"
                        title="تعديل"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(zone.id, zone.nameAr)}
                        className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:text-danger hover:bg-danger/10 transition-all"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-8 p-6 glass-card border-primary/20 bg-primary/5 flex items-start gap-4">
        <Info className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-bold text-white mb-1 tracking-tight">ملاحظة محاسبية هامة:</p>
          <p className="text-text-muted leading-relaxed">
            عند تعديل سعر التوصيل، سيتم تطبيق السعر الجديد على الطلبات المستقبلية فقط. الطلبات السابقة ستحتفظ بالسعر الذي تم فيه إنشاء الطلب لضمان دقة التقارير المالية.
            تذكر أن نظام الإحصائيات في لوحة التحكم يقوم باستبعاد رسوم التوصيل تلقائياً من "صافي المبيعات".
          </p>
        </div>
      </div>

      {/* Add/Edit Modal */}
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
              className="relative w-full max-w-lg bg-[#0B0F19] rounded-[40px] border border-white/10 shadow-3xl overflow-hidden"
            >
              <div className="p-8 md:p-10">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-2xl font-black text-white">{editingId ? 'تعديل المنطقة' : 'إضافة منطقة توصيل'}</h2>
                    <p className="text-text-muted text-xs mt-1">اضبط بيانات التوصيل والتسعير بدقة</p>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all">
                    <X className="w-6 h-6 text-white" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 gap-5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">اسم المنطقة (العربية)</label>
                      <input 
                        required 
                        type="text" 
                        placeholder="مثلاً: عبدون" 
                        className="glass-input h-14 px-6 text-lg font-bold text-right" 
                        value={formData.nameAr} 
                        onChange={e => setFormData({...formData, nameAr: e.target.value})} 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-text-muted px-2">Zone Name (English)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Abdoun" 
                        className="glass-input h-14 px-6 text-lg font-bold text-left" 
                        dir="ltr"
                        value={formData.nameEn} 
                        onChange={e => setFormData({...formData, nameEn: e.target.value})} 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted px-2">سعر التوصيل</label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                          <input 
                            required 
                            type="number" 
                            step="0.01" 
                            placeholder="0.00" 
                            className="glass-input h-14 pl-10 pr-6 font-mono font-bold" 
                            value={formData.fee} 
                            onChange={e => setFormData({...formData, fee: e.target.value})} 
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted px-2">الحد الأدنى للطلب</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00" 
                          className="glass-input h-14 px-6 font-mono font-bold" 
                          value={formData.minOrder} 
                          onChange={e => setFormData({...formData, minOrder: e.target.value})} 
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-2 pt-2">
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-white">ترتيب العرض:</span>
                        <input 
                          type="number" 
                          className="w-20 bg-white/5 border border-white/5 rounded-xl py-2 px-4 text-center font-mono font-bold text-primary" 
                          value={formData.sortOrder} 
                          onChange={e => setFormData({...formData, sortOrder: e.target.value})} 
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-white">الحالة:</span>
                        <Switch 
                          checked={formData.isActive} 
                          onChange={val => setFormData({...formData, isActive: val})} 
                        />
                      </div>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full h-16 bg-primary text-white text-lg font-black rounded-3xl shadow-2xl flex items-center justify-center gap-3 hover:shadow-primary/20 transition-all mt-6"
                  >
                    <Check className="w-6 h-6" />
                    <span>{editingId ? 'تحيين البيانات' : 'اعتماد المنطقة'}</span>
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DeliveryZonesManager;
