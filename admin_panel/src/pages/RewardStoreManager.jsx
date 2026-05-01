import { useState, useEffect } from 'react';
import { Gift, Plus, Edit, Trash2, Save, X, Image as ImageIcon, Stars } from 'lucide-react';
import Header from '../components/Header';
import api, { unwrap } from '../api/client';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const RewardStoreManager = () => {
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    titleEn: '',
    description: '',
    descriptionEn: '',
    pointsCost: 500,
    imageUrl: '',
    isActive: true
  });

  useEffect(() => {
    fetchRewards();
  }, []);

  const fetchRewards = async () => {
    try {
      setLoading(true);
      const data = unwrap(await api.get('/loyalty/rewards'));
      setRewards(data || []);
    } catch (error) {
      toast.error('فشل في جلب المكافآت');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (reward = null) => {
    if (reward) {
      setEditingReward(reward);
      setFormData({
        title: reward.title,
        titleEn: reward.titleEn || '',
        description: reward.description || '',
        descriptionEn: reward.descriptionEn || '',
        pointsCost: reward.pointsCost,
        imageUrl: reward.imageUrl || '',
        isActive: reward.isActive
      });
    } else {
      setEditingReward(null);
      setFormData({
        title: '',
        titleEn: '',
        description: '',
        descriptionEn: '',
        pointsCost: 500,
        imageUrl: '',
        isActive: true
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingReward(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title || formData.pointsCost <= 0) {
      toast.error('يرجى تعبئة الحقول الأساسية بشكل صحيح');
      return;
    }

    try {
      if (editingReward) {
        await api.put(`/loyalty/rewards/${editingReward.id}`, formData);
        toast.success('تم تحديث المكافأة بنجاح');
      } else {
        await api.post('/loyalty/rewards', formData);
        toast.success('تمت إضافة المكافأة بنجاح');
      }
      handleCloseModal();
      fetchRewards();
    } catch (error) {
      toast.error('حدث خطأ أثناء الحفظ');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه المكافأة نهائياً؟')) return;
    try {
      await api.delete(`/loyalty/rewards/${id}`);
      toast.success('تم الحذف بنجاح');
      fetchRewards();
    } catch (error) {
      toast.error('حدث خطأ أثناء الحذف');
    }
  };

  const toggleActiveStatus = async (reward) => {
    try {
      await api.put(`/loyalty/rewards/${reward.id}`, { isActive: !reward.isActive });
      toast.success(reward.isActive ? 'تم إيقاف المكافأة' : 'تم تفعيل المكافأة');
      fetchRewards();
    } catch (error) {
      toast.error('حدث خطأ أثناء تغيير الحالة');
    }
  };

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-screen">
      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen">
      <Header 
        title="متجر المكافآت" 
        subtitle="إدارة الوجبات والمنتجات التي يمكن للزبائن استبدال نقاطهم بها" 
        action={
          <button 
            onClick={() => handleOpenModal()}
            className="bg-primary hover:bg-primary/90 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all"
          >
            <Plus className="w-5 h-5" />
            <span>إضافة مكافأة جديدة</span>
          </button>
        }
      />

      {rewards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 mt-8">
          <Gift className="w-20 h-20 text-text-muted mb-6 opacity-50" />
          <h3 className="text-xl font-bold text-white mb-2">لا توجد مكافآت حالياً</h3>
          <p className="text-text-muted text-sm text-center max-w-md">قم بإضافة وجبات ومكافآت ليتمكن الزبائن من استبدال نقاطهم بها في تطبيق الموبايل.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-8">
          {rewards.map((reward) => (
            <motion.div 
              key={reward.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 overflow-hidden transition-all hover:border-primary/30 group ${!reward.isActive ? 'opacity-70 grayscale-[50%]' : ''}`}
            >
              <div className="h-48 bg-black/20 relative overflow-hidden">
                {reward.imageUrl ? (
                  <img src={reward.imageUrl} alt={reward.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-text-muted">
                    <ImageIcon className="w-10 h-10 mb-2 opacity-50" />
                    <span className="text-xs">بدون صورة</span>
                  </div>
                )}
                
                {/* Status Badge */}
                <div className="absolute top-4 right-4">
                  <button 
                    onClick={() => toggleActiveStatus(reward)}
                    className={`px-3 py-1 rounded-full text-xs font-bold border backdrop-blur-md transition-colors ${
                      reward.isActive 
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30' 
                        : 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30'
                    }`}
                  >
                    {reward.isActive ? 'متاح للجميع' : 'متوقف'}
                  </button>
                </div>

                {/* Points Badge */}
                <div className="absolute bottom-4 left-4 bg-primary text-white px-4 py-2 rounded-xl font-black shadow-lg shadow-primary/20 flex items-center gap-2">
                  <Stars className="w-4 h-4" />
                  <span>{reward.pointsCost} نقطة</span>
                </div>
              </div>

              <div className="p-6">
                <h3 className="text-xl font-bold text-white mb-2">{reward.title}</h3>
                {reward.description && (
                  <p className="text-sm text-text-muted mb-6 line-clamp-2">{reward.description}</p>
                )}

                <div className="flex gap-2 border-t border-white/5 pt-4">
                  <button 
                    onClick={() => handleOpenModal(reward)}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white py-2 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    <span>تعديل</span>
                  </button>
                  <button 
                    onClick={() => handleDelete(reward.id)}
                    className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 py-2 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1a1b23] border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-white/5">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  {editingReward ? <Edit className="w-5 h-5 text-primary" /> : <Plus className="w-5 h-5 text-primary" />}
                  {editingReward ? 'تعديل المكافأة' : 'إضافة مكافأة جديدة'}
                </h2>
                <button onClick={handleCloseModal} className="p-2 hover:bg-white/5 rounded-full text-text-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Title */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">اسم المكافأة (عربي) *</label>
                    <input 
                      type="text" 
                      required
                      value={formData.title} 
                      onChange={e => setFormData({...formData, title: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-primary transition-colors"
                      placeholder="مثال: وجبة شاورما دجاج"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">اسم المكافأة (إنجليزي)</label>
                    <input 
                      type="text" 
                      value={formData.titleEn} 
                      onChange={e => setFormData({...formData, titleEn: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-primary transition-colors text-left"
                      placeholder="e.g: Chicken Shawerma Meal"
                      dir="ltr"
                    />
                  </div>

                  {/* Points */}
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">تكلفة المكافأة (نقاط) *</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        required
                        min="1"
                        value={formData.pointsCost} 
                        onChange={e => setFormData({...formData, pointsCost: parseInt(e.target.value) || 0})}
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-primary transition-colors pl-12"
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-primary">
                        <Stars className="w-5 h-5" />
                      </div>
                    </div>
                  </div>

                  {/* Descriptions */}
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">وصف تفصيلي (عربي)</label>
                    <textarea 
                      value={formData.description} 
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-primary transition-colors min-h-[100px]"
                      placeholder="ما الذي تتضمنه هذه الوجبة؟"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">وصف تفصيلي (إنجليزي)</label>
                    <textarea 
                      value={formData.descriptionEn} 
                      onChange={e => setFormData({...formData, descriptionEn: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-primary transition-colors min-h-[100px] text-left"
                      placeholder="What is included in this meal?"
                      dir="ltr"
                    />
                  </div>

                  {/* Image URL */}
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">رابط صورة الوجبة (اختياري)</label>
                    <div className="relative">
                      <input 
                        type="url" 
                        value={formData.imageUrl} 
                        onChange={e => setFormData({...formData, imageUrl: e.target.value})}
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 pr-10 text-white outline-none focus:border-primary transition-colors text-left"
                        placeholder="https://example.com/image.jpg"
                        dir="ltr"
                      />
                      <ImageIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                    </div>
                  </div>

                  {/* Status */}
                  <div className="md:col-span-2 flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-xl">
                    <div>
                      <h4 className="text-white font-bold">الحالة</h4>
                      <p className="text-xs text-text-muted">هل هذه المكافأة متاحة للزبائن الآن؟</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={formData.isActive}
                        onChange={e => setFormData({...formData, isActive: e.target.checked})}
                      />
                      <div className="w-14 h-7 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5 flex gap-4">
                  <button 
                    type="submit"
                    className="flex-1 bg-primary hover:bg-primary/90 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all"
                  >
                    <Save className="w-5 h-5" />
                    <span>حفظ المكافأة</span>
                  </button>
                  <button 
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl font-bold transition-all"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RewardStoreManager;
