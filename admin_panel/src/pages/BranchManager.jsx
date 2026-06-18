import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { 
  Building2, 
  MapPin, 
  Phone, 
  Settings2,
  Plus,
  PowerOff,
  Power,
  X,
  AlertTriangle
} from 'lucide-react';
import { useSocket } from '../hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

const BranchManager = () => {
  const { socket } = useSocket();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSocketConnected, setIsSocketConnected] = useState(() => !!socket?.connected);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    managerEmail: '',
    managerPassword: '',
    managerPin: ''
  });

  const [submitting, setSubmitting] = useState(false);

  const fetchBranches = useCallback(async () => {
    try {
      const response = await api.get('/branch');
      setBranches(response.data.data || []);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch branches', err);
      toast.error('فشل في جلب قائمة الفروع');
    }
  }, []);

  useEffect(() => {
    fetchBranches();
    
    if (!socket) return;

    setIsSocketConnected(socket.connected);

    const onConnect = () => setIsSocketConnected(true);
    const onDisconnect = () => setIsSocketConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('branch:updated', fetchBranches);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('branch:updated', fetchBranches);
    };
  }, [fetchBranches, socket]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      address: '',
      phone: '',
      managerEmail: '',
      managerPassword: '',
      managerPin: ''
    });
    setSelectedBranch(null);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.code || !formData.managerEmail || !formData.managerPassword || !formData.managerPin) {
      toast.error('يرجى تعبئة جميع الحقول المطلوبة');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/branch', formData);
      toast.success('تم إنشاء الفرع بنجاح');
      setIsCreateModalOpen(false);
      resetForm();
    } catch (err) {
      toast.error(err.response?.data?.message || 'حدث خطأ أثناء إنشاء الفرع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name) {
      toast.error('اسم الفرع مطلوب');
      return;
    }
    setSubmitting(true);
    try {
      await api.put(`/branch/${selectedBranch.id}`, {
        name: formData.name,
        address: formData.address,
        phone: formData.phone
      });
      toast.success('تم تحديث الفرع بنجاح');
      setIsEditModalOpen(false);
      resetForm();
    } catch (err) {
      toast.error(err.response?.data?.message || 'حدث خطأ أثناء تحديث الفرع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async () => {
    setSubmitting(true);
    try {
      await api.patch(`/branch/${selectedBranch.id}/status`, {
        isActive: !selectedBranch.isActive
      });
      toast.success(`تم ${!selectedBranch.isActive ? 'تفعيل' : 'تعطيل'} الفرع بنجاح`);
      setIsConfirmModalOpen(false);
      setSelectedBranch(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'حدث خطأ أثناء تحديث حالة الفرع');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (branch) => {
    setSelectedBranch(branch);
    setFormData({
      name: branch.name || '',
      code: branch.code || '',
      address: branch.address || '',
      phone: branch.phone || '',
      managerEmail: '',
      managerPassword: '',
      managerPin: ''
    });
    setIsEditModalOpen(true);
  };

  const openConfirmModal = (branch) => {
    setSelectedBranch(branch);
    setIsConfirmModalOpen(true);
  };

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-slate-200">
      {/* 🚀 Header Section */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            إدارة الفروع
          </h1>
          <p className="text-slate-500 text-sm mt-1 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isSocketConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
            {isSocketConnected ? 'متصل لتحديث الفروع فورياً' : 'جاري الاتصال...'}
          </p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsCreateModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          إضافة فرع جديد
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {branches.map((branch, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              key={branch.id} 
              className={`bg-slate-900/50 backdrop-blur-xl border ${branch.isActive ? 'border-slate-800' : 'border-red-500/30'} p-6 rounded-2xl relative overflow-hidden`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl ${branch.isActive ? 'bg-blue-500/10 text-blue-500' : 'bg-slate-800 text-slate-500'}`}>
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{branch.name}</h3>
                    <p className="text-sm text-slate-500 font-mono mt-0.5">كود: {branch.code || 'غير متوفر'}</p>
                  </div>
                </div>
                <span className={`text-[10px] uppercase font-bold px-3 py-1 rounded-full ${branch.isActive ? 'text-green-500 bg-green-500/10 border border-green-500/20' : 'text-red-500 bg-red-500/10 border border-red-500/20'}`}>
                  {branch.isActive ? 'نشط 🟢' : 'معطل 🔴'}
                </span>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <MapPin className="w-4 h-4" />
                  <span className="truncate">{branch.address || 'لم يتم تحديد العنوان'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Phone className="w-4 h-4" />
                  <span>{branch.phone || 'لم يتم تحديد الهاتف'}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-800">
                <button 
                  onClick={() => openEditModal(branch)}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors"
                >
                  <Settings2 className="w-4 h-4" />
                  تعديل
                </button>
                <button 
                  onClick={() => openConfirmModal(branch)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors ${branch.isActive ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}`}
                >
                  {branch.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                  {branch.isActive ? 'تعطيل' : 'تفعيل'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* 🟢 Create Branch Modal */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsCreateModalOpen(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl m-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">إضافة فرع جديد ومدير</h2>
                <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-500 hover:text-white"><X className="w-6 h-6" /></button>
              </div>
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">اسم الفرع *</label>
                    <input type="text" name="name" value={formData.name} onChange={handleInputChange} required className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="مثال: فرع الزرقاء" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">كود الفرع * <span className="text-[10px]">(لا يتغير لاحقاً)</span></label>
                    <input type="text" name="code" value={formData.code} onChange={handleInputChange} required className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none uppercase font-mono" placeholder="ZRQ" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">العنوان</label>
                  <input type="text" name="address" value={formData.address} onChange={handleInputChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="شارع الأمير حسن" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">رقم الهاتف</label>
                  <input type="text" name="phone" value={formData.phone} onChange={handleInputChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="053001010" />
                </div>
                <hr className="border-slate-800 my-4" />
                <h3 className="text-lg font-bold mb-2">بيانات مدير الفرع الأساسي</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-400 mb-1">البريد الإلكتروني *</label>
                    <input type="email" name="managerEmail" value={formData.managerEmail} onChange={handleInputChange} required className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="manager@zrq.branch" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">كلمة المرور *</label>
                    <input type="password" name="managerPassword" value={formData.managerPassword} onChange={handleInputChange} required minLength="8" className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">رمز التحقق (PIN) * <span className="text-[10px]">(4 أرقام)</span></label>
                    <input type="text" name="managerPin" value={formData.managerPin} onChange={handleInputChange} required pattern="\d{4}" maxLength="4" className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none tracking-[1em] text-center" placeholder="1234" />
                  </div>
                </div>
                <div className="flex gap-3 pt-4 mt-4 border-t border-slate-800">
                  <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">إلغاء</button>
                  <button type="submit" disabled={submitting} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex justify-center items-center">
                    {submitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'حفظ الفرع'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 🔵 Edit Branch Modal */}
      <AnimatePresence>
        {isEditModalOpen && selectedBranch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsEditModalOpen(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl m-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">تعديل بيانات الفرع</h2>
                <button onClick={() => setIsEditModalOpen(false)} className="text-slate-500 hover:text-white"><X className="w-6 h-6" /></button>
              </div>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">اسم الفرع *</label>
                  <input type="text" name="name" value={formData.name} onChange={handleInputChange} required className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">كود الفرع (للقراءة فقط)</label>
                  <input type="text" value={formData.code} disabled className="w-full bg-slate-900 border border-slate-800 text-slate-500 rounded-lg py-2 px-3 cursor-not-allowed font-mono" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">العنوان</label>
                  <input type="text" name="address" value={formData.address} onChange={handleInputChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">رقم الهاتف</label>
                  <input type="text" name="phone" value={formData.phone} onChange={handleInputChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="flex gap-3 pt-4 mt-4 border-t border-slate-800">
                  <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">إلغاء</button>
                  <button type="submit" disabled={submitting} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex justify-center items-center">
                    {submitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'حفظ التعديلات'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 🔴 Confirmation Modal (Toggle Status) */}
      <AnimatePresence>
        {isConfirmModalOpen && selectedBranch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsConfirmModalOpen(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl m-4">
              <div className="flex items-center gap-4 mb-4">
                <div className={`p-3 rounded-full ${selectedBranch.isActive ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                  {selectedBranch.isActive ? <AlertTriangle className="w-8 h-8" /> : <Power className="w-8 h-8" />}
                </div>
                <h2 className="text-xl font-bold">
                  {selectedBranch.isActive ? `تعطيل ${selectedBranch.name}` : `تفعيل ${selectedBranch.name}`}
                </h2>
              </div>
              
              {selectedBranch.isActive ? (
                <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 mb-6">
                  <p className="text-slate-300 mb-2 font-medium">هل أنت متأكد؟ سيؤدي هذا إلى:</p>
                  <ul className="list-disc list-inside text-sm text-slate-400 space-y-1">
                    <li>عدم تمكن موظفي الفرع من تسجيل الدخول</li>
                    <li>اختفاء الفرع من قائمة اختيار الفرع في التطبيق</li>
                    <li>لن تُحذف أي بيانات — يمكن إعادة التفعيل لاحقاً</li>
                  </ul>
                </div>
              ) : (
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4 mb-6">
                  <p className="text-slate-300 text-sm">سيتم إعادة تفعيل الفرع وسيظهر في التطبيق، وسيتمكن الموظفون من تسجيل الدخول فوراً.</p>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setIsConfirmModalOpen(false)} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">إلغاء</button>
                <button 
                  type="button" 
                  onClick={handleToggleStatus} 
                  disabled={submitting} 
                  className={`flex-1 py-2 text-white rounded-lg transition-colors flex justify-center items-center ${selectedBranch.isActive ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                >
                  {submitting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    selectedBranch.isActive ? 'نعم، عطّل الفرع' : 'نعم، فعّل الفرع'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default BranchManager;
