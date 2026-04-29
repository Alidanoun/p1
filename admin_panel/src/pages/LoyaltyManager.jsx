import { useState, useEffect } from 'react';
import { Stars, Settings, Save, TrendingUp, Gift, Share2, MessageSquare, UserPlus } from 'lucide-react';
import Header from '../components/Header';
import api, { unwrap } from '../api/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

const LoyaltyManager = () => {
  const [settings, setSettings] = useState({
    pointsPerJod: 10,
    tierGoldMinOrders: 10,
    tierPlatinumMinOrders: 25,
    pointsMultiplierGold: 1.5,
    pointsMultiplierPlatinum: 2.0,
    reviewPoints: 50,
    referralPoints: 100,
    socialSharePoints: 20,
    isHappyHourEnabled: false,
    happyHourMultiplier: 2.0,
    happyHourStart: '16:00',
    happyHourEnd: '18:00',
  });
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const data = unwrap(await api.get('/loyalty/settings'));
      if (data) {
        setSettings(data);
      }
    } catch (error) {
      toast.error('فشل في جلب إعدادات الولاء');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async () => {
    setIsSaving(true);
    try {
      await api.patch('/loyalty/settings', settings);
      toast.success('تم حفظ إعدادات الولاء بنجاح');
    } catch (error) {
      toast.error('فشل في حفظ التعديلات');
    } finally {
      setIsSaving(false);
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
        title="إدارة نظام الولاء" 
        subtitle="تحكم في النقاط، المستويات، والمكافآت التفاعلية" 
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 mt-6">
        
        {/* Left Column: General & Tiers */}
        <div className="xl:col-span-2 space-y-8">
          
          {/* Base Rules */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 p-8"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="bg-primary/10 p-3 rounded-2xl text-primary">
                <Stars className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white">القواعد الأساسية</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <SettingCard 
                title="النقاط مقابل الدينار"
                description="عدد النقاط التي يكتسبها العميل مقابل كل 1 دينار مصروف."
                value={settings.pointsPerJod}
                onChange={(val) => setSettings({...settings, pointsPerJod: parseFloat(val)})}
                suffix="نقطة / دينار"
              />
            </div>
          </motion.div>

          {/* Tier Rules */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 p-8"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="bg-amber-500/10 p-3 rounded-2xl text-amber-500">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white">مستويات الزبائن</h2>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white/5 rounded-2xl p-6 border border-white/5 space-y-4">
                  <div className="flex items-center gap-2 text-amber-400">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="font-bold">المستوى الذهبي</span>
                  </div>
                  <SettingInput 
                    label="الحد الأدنى للطلبات"
                    value={settings.tierGoldMinOrders}
                    onChange={(val) => setSettings({...settings, tierGoldMinOrders: parseInt(val)})}
                    suffix="طلب"
                  />
                  <SettingInput 
                    label="مضاعف النقاط"
                    value={settings.pointsMultiplierGold}
                    onChange={(val) => setSettings({...settings, pointsMultiplierGold: parseFloat(val)})}
                    suffix="x"
                    step="0.1"
                  />
                </div>

                <div className="bg-white/5 rounded-2xl p-6 border border-white/5 space-y-4">
                  <div className="flex items-center gap-2 text-slate-300">
                    <div className="w-2 h-2 rounded-full bg-slate-300" />
                    <span className="font-bold">المستوى البلاتيني</span>
                  </div>
                  <SettingInput 
                    label="الحد الأدنى للطلبات"
                    value={settings.tierPlatinumMinOrders}
                    onChange={(val) => setSettings({...settings, tierPlatinumMinOrders: parseInt(val)})}
                    suffix="طلب"
                  />
                  <SettingInput 
                    label="مضاعف النقاط"
                    value={settings.pointsMultiplierPlatinum}
                    onChange={(val) => setSettings({...settings, pointsMultiplierPlatinum: parseFloat(val)})}
                    suffix="x"
                    step="0.1"
                  />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Happy Hour Rules */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 p-8"
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-500/10 p-3 rounded-2xl text-indigo-500">
                  <Gift className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white">ساعات السعادة (Happy Hour)</h2>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={settings.isHappyHourEnabled}
                  onChange={(e) => setSettings({...settings, isHappyHourEnabled: e.target.checked})}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 transition-opacity duration-300 ${settings.isHappyHourEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <SettingInput 
                label="بداية الوقت"
                value={settings.happyHourStart}
                onChange={(val) => setSettings({...settings, happyHourStart: val})}
                suffix=""
              />
              <SettingInput 
                label="نهاية الوقت"
                value={settings.happyHourEnd}
                onChange={(val) => setSettings({...settings, happyHourEnd: val})}
                suffix=""
              />
              <SettingInput 
                label="مضاعف النقاط"
                value={settings.happyHourMultiplier}
                onChange={(val) => setSettings({...settings, happyHourMultiplier: parseFloat(val)})}
                suffix="x"
                step="0.1"
              />
            </div>
          </motion.div>
        </div>

        {/* Right Column: Engagement & Save */}
        <div className="space-y-8">
          
          {/* Engagement Rewards */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 p-8"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="bg-emerald-500/10 p-3 rounded-2xl text-emerald-500">
                <Share2 className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white">مكافآت التفاعل</h2>
            </div>

            <div className="space-y-4">
              <EngagementItem 
                icon={<MessageSquare className="w-4 h-4" />}
                title="تقييم وجبة"
                value={settings.reviewPoints}
                onChange={(val) => setSettings({...settings, reviewPoints: parseInt(val)})}
              />
              <EngagementItem 
                icon={<UserPlus className="w-4 h-4" />}
                title="دعوة صديق"
                value={settings.referralPoints}
                onChange={(val) => setSettings({...settings, referralPoints: parseInt(val)})}
              />
              <EngagementItem 
                icon={<Share2 className="w-4 h-4" />}
                title="مشاركة المنتج"
                value={settings.socialSharePoints}
                onChange={(val) => setSettings({...settings, socialSharePoints: parseInt(val)})}
              />
            </div>
          </motion.div>

          {/* Action Button */}
          <div className="sticky bottom-8">
            <button
              onClick={handleUpdateSettings}
              disabled={isSaving}
              className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-5 rounded-2xl shadow-2xl shadow-primary/20 transition-all flex items-center justify-center gap-3 group overflow-hidden relative"
            >
              <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <Save className={isSaving ? 'animate-spin' : 'relative z-10'} />
              <span className="relative z-10 text-lg">{isSaving ? 'جاري الحفظ...' : 'حفظ جميع الإعدادات'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

const SettingCard = ({ title, description, value, onChange, suffix }) => (
  <div className="bg-white/5 rounded-2xl p-6 border border-white/5 flex flex-col justify-between gap-4">
    <div className="space-y-1">
      <h3 className="font-bold text-white">{title}</h3>
      <p className="text-xs text-text-muted">{description}</p>
    </div>
    <div className="flex items-center gap-3">
      <input 
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-background border border-white/10 rounded-xl px-4 py-3 text-center text-white font-bold outline-none focus:border-primary transition-all"
      />
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{suffix}</span>
    </div>
  </div>
);

const SettingInput = ({ label, value, onChange, suffix, step = "1" }) => (
  <div className="flex flex-col gap-2">
    <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest">{label}</label>
    <div className="flex items-center gap-2">
      <input 
        type={typeof value === 'string' && value.includes(':') ? 'text' : 'number'}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={typeof value === 'string' && value.includes(':') ? 'HH:mm' : ''}
        className="flex-1 bg-background border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-bold outline-none focus:border-primary transition-all"
      />
      {suffix && <span className="text-[10px] font-bold text-text-muted">{suffix}</span>}
    </div>
  </div>
);

const EngagementItem = ({ icon, title, value, onChange }) => (
  <div className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5">
    <div className="flex items-center gap-3">
      <div className="p-2 bg-white/5 rounded-lg text-text-muted">
        {icon}
      </div>
      <span className="text-sm font-medium text-white">{title}</span>
    </div>
    <div className="flex items-center gap-2">
      <input 
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 bg-background border border-white/10 rounded-lg px-2 py-1 text-center text-xs text-white font-bold outline-none focus:border-primary"
      />
      <span className="text-[9px] text-text-muted font-bold">نقطة</span>
    </div>
  </div>
);

export default LoyaltyManager;
