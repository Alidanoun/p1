import { useState, useEffect } from 'react';
import { Stars, Settings, Save, AlertCircle, TrendingUp, Users, History, Gift } from 'lucide-react';
import Header from '../components/Header';
import api from '../api/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

const LoyaltyManager = () => {
  const [settings, setSettings] = useState({
    cancellation_compensation_points: '50'
  });
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/settings');
      setSettings(prev => ({ ...prev, ...data }));
    } catch (error) {
      toast.error('فشل في جلب الإعدادات');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSetting = async () => {
    setIsSaving(true);
    try {
      await api.post('/settings', {
        key: 'cancellation_compensation_points',
        value: settings.cancellation_compensation_points
      });
      toast.success('تم حفظ الإعدادات بنجاح');
    } catch (error) {
      toast.error('فشل في حفظ التعديلات');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen">
      <Header 
        title="إدارة نظام الولاء" 
        subtitle="تحكم في النقاط، المكافآت، وقواعد تعويض الزبائن" 
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-6">
        {/* Main Settings Card */}
        <div className="lg:col-span-2 space-y-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 md:p-8"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="bg-primary/10 p-2 rounded-lg text-primary">
                <Settings className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white">إعدادات التعويضات</h2>
            </div>

            <div className="space-y-6">
              <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-bold text-white">نقاط الاعتذار عن التأخير</h3>
                    <p className="text-xs text-text-muted">عدد النقاط الممنوحة تلقائياً عند قبول إلغاء طلب بسبب تأخر المطعم.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input 
                      type="number"
                      value={settings.cancellation_compensation_points}
                      onChange={(e) => setSettings({...settings, cancellation_compensation_points: e.target.value})}
                      className="w-24 bg-background border border-white/10 rounded-xl px-4 py-3 text-center text-white font-bold outline-none focus:border-primary transition-all"
                    />
                    <span className="text-xs font-bold text-text-muted">نقطة</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5 flex justify-end">
                <button
                  onClick={handleUpdateSetting}
                  disabled={isSaving}
                  className="bg-primary hover:bg-primary/90 text-white font-bold px-8 py-3 rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center gap-2 group"
                >
                  <Save className={isSaving ? 'animate-spin' : 'group-hover:scale-110 transition-transform'} />
                  {isSaving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
                </button>
              </div>
            </div>
          </motion.div>

          {/* Coming Soon Features */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-50">
             <div className="bg-card/20 rounded-2xl border border-dashed border-white/10 p-6 flex flex-col items-center justify-center text-center">
                <TrendingUp className="w-10 h-10 text-text-muted mb-4" />
                <h3 className="font-bold text-text-muted">مستويات الزبائن</h3>
                <p className="text-xs text-text-muted">قريباً: برونزي، فضي، ذهبي</p>
             </div>
             <div className="bg-card/20 rounded-2xl border border-dashed border-white/10 p-6 flex flex-col items-center justify-center text-center">
                <Gift className="w-10 h-10 text-text-muted mb-4" />
                <h3 className="font-bold text-text-muted">متجر المكافآت</h3>
                <p className="text-xs text-text-muted">قريباً: استبدال النقاط بمنتجات</p>
             </div>
          </div>
        </div>

        {/* Sidebar Info Cards */}
        <div className="space-y-6">

           <div className="bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-6">
              <div className="flex items-center gap-3 mb-6">
                 <History className="w-5 h-5 text-text-muted" />
                 <h3 className="font-bold text-white uppercase text-xs tracking-widest">إحصائيات الولاء</h3>
              </div>
              <div className="space-y-4">
                 <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                    <span className="text-xs text-text-muted">إجمالي نقاط الزبائن</span>
                    <span className="text-lg font-black text-white">--</span>
                 </div>
                 <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                    <span className="text-xs text-text-muted">أكثر زبون نقاطاً</span>
                    <span className="text-sm font-bold text-primary">قيد الحساب</span>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default LoyaltyManager;
