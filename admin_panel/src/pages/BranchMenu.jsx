import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Search, Filter, CheckCircle2, XCircle, Info, Loader2, UtensilsCrossed, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api, { unwrap } from '../api/client';

const BranchMenu = () => {
  const { user, selectedBranchId } = useAuth();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // all, available, unavailable

  const fetchData = async () => {
    setLoading(true);
    try {
      const branchId = selectedBranchId || user.branchId;
      // Fetch items with branch context
      const [itemsRes, catsRes] = await Promise.all([
        api.get(`/items?branchId=${branchId}`),
        api.get('/categories')
      ]);
      
      setItems(unwrap(itemsRes) || []);
      setCategories(unwrap(catsRes) || []);
    } catch (error) {
      console.error('Failed to fetch branch menu:', error);
      toast.error('فشل تحميل بيانات المنيو');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user.branchId, selectedBranchId]);

  const toggleAvailability = async (itemId, currentStatus) => {
    const newStatus = !currentStatus;
    
    // 🧠 Optimistic UI Update
    const previousItems = [...items];
    setItems(items.map(item => 
      item.id === itemId ? { ...item, isAvailable: newStatus } : item
    ));

    try {
      const branchId = selectedBranchId || user.branchId;
      const response = await api.post('/branch/items/toggle', {
        itemId,
        isAvailable: newStatus,
        branchId
      });

      if (response.data.success) {
        toast.success(`تم ${newStatus ? 'تفعيل' : 'إيقاف'} الصنف بنجاح`, {
          icon: newStatus ? <CheckCircle2 className="text-emerald-500" /> : <XCircle className="text-danger" />
        });
      }
    } catch (error) {
      console.error('Toggle failed:', error);
      toast.error('فشل تحديث حالة الصنف');
      // Rollback on failure
      setItems(previousItems);
    }
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase()) || 
                         (item.titleEn && item.titleEn.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || item.categoryId === parseInt(selectedCategory);
    const matchesStatus = filterStatus === 'all' || 
                         (filterStatus === 'available' && item.isAvailable) || 
                         (filterStatus === 'unavailable' && !item.isAvailable);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className="p-8 max-w-[1600px] mx-auto animate-in fade-in duration-500">
      {/* Header Section */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <UtensilsCrossed className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-text-main">منيو الفرع</h1>
          </div>
          <p className="text-text-muted">إدارة توفر الوجبات والأصناف لفرعك الحالي بشكل لحظي</p>
        </div>

        <button 
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-card hover:bg-white/10 border border-border-subtle rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث المنيو
        </button>
      </header>

      {/* Filters Bar */}
      <section className="bg-card/50 backdrop-blur-md border border-border-subtle p-6 rounded-2xl mb-8 flex flex-wrap items-center gap-6">
        <div className="flex-1 min-w-[300px] relative group">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="ابحث عن صنف معين..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-background/50 border border-border-subtle focus:border-primary rounded-xl py-3 pr-12 pl-4 outline-none transition-all text-sm font-medium"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-background/50 border border-border-subtle rounded-xl">
            <Filter className="w-4 h-4 text-text-muted" />
            <select 
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent outline-none text-sm font-bold cursor-pointer min-w-[120px]"
            >
              <option value="all">كل التصنيفات</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className="flex bg-background/50 border border-border-subtle rounded-xl p-1">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'available', label: 'متاح' },
              { id: 'unavailable', label: 'غير متاح' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filterStatus === tab.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-text-muted hover:text-text-main'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Items Grid */}
      {loading ? (
        <div className="h-[400px] flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
          <p className="text-text-muted font-medium">جاري تحميل قائمة المنيو...</p>
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredItems.map((item) => (
              <motion.div
                layout
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`group bg-card border transition-all duration-300 rounded-3xl overflow-hidden flex flex-col ${
                  item.isAvailable ? 'border-border-subtle hover:border-primary/30' : 'border-danger/20 opacity-80'
                }`}
              >
                {/* Image & Overlay */}
                <div className="relative aspect-video overflow-hidden">
                  <img 
                    src={item.image || 'https://via.placeholder.com/400x225?text=No+Image'} 
                    alt={item.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-t transition-opacity duration-300 ${
                    item.isAvailable ? 'from-black/60 to-transparent opacity-0 group-hover:opacity-100' : 'from-danger/40 to-danger/10 opacity-100'
                  }`} />
                  
                  {!item.isAvailable && (
                    <div className="absolute top-4 left-4 bg-danger text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-lg">
                      غير متاح حالياً
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-6 flex-1 flex flex-col">
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <h3 className="font-bold text-lg text-text-main leading-tight">{item.title}</h3>
                    <span className="text-primary font-black whitespace-nowrap">{item.basePrice} د.أ</span>
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2 mb-6 h-8">{item.description || 'لا يوجد وصف متاح'}</p>

                  <div className="mt-auto pt-4 border-t border-border-subtle flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${item.isAvailable ? 'bg-emerald-500 animate-pulse' : 'bg-danger'}`} />
                      <span className={`text-xs font-bold ${item.isAvailable ? 'text-emerald-500' : 'text-danger'}`}>
                        {item.isAvailable ? 'نشط في الفرع' : 'متوقف'}
                      </span>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={item.isAvailable}
                        onChange={() => toggleAvailability(item.id, item.isAvailable)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-text-muted after:border-border-subtle after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-white peer-checked:after:border-transparent group-hover:after:scale-110"></div>
                    </label>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="h-[400px] flex flex-col items-center justify-center gap-6 bg-card/20 rounded-3xl border border-dashed border-border-subtle">
          <div className="p-4 bg-white/5 rounded-full">
            <Search className="w-10 h-10 text-text-muted" />
          </div>
          <div className="text-center">
            <h3 className="text-xl font-bold text-text-main mb-2">لا توجد نتائج مطابقة</h3>
            <p className="text-text-muted text-sm">حاول تغيير خيارات البحث أو الفلترة أعلاه</p>
          </div>
          <button 
            onClick={() => { setSearch(''); setSelectedCategory('all'); setFilterStatus('all'); }}
            className="text-primary text-sm font-bold hover:underline"
          >
            إعادة تعيين كافة الفلاتر
          </button>
        </div>
      )}

      {/* Info Card */}
      <footer className="mt-12 p-6 bg-blue-500/5 border border-blue-500/10 rounded-2xl flex items-start gap-4">
        <Info className="w-6 h-6 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-bold text-blue-500 mb-1">معلومة هامة للمدير</h4>
          <p className="text-xs text-text-muted leading-relaxed">
            تغيير حالة توفر الصنف هنا يؤثر فقط على **فرعك الحالي**. إذا تم إيقاف صنف من قبل الإدارة العامة (Super Admin)، فلن يظهر في هذه القائمة أو سيظهر كمعطل بشكل دائم ولا يمكن تفعيله من هنا.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default BranchMenu;
