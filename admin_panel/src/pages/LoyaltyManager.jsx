import { useState, useEffect } from 'react';
import { Stars, Settings, Save, TrendingUp, Gift, Share2, MessageSquare, UserPlus } from 'lucide-react';
import Header from '../components/Header';
import api, { unwrap } from '../api/client';
import { useSocket } from '../contexts/SocketContext';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

const LoyaltyManager = () => {
  const { socket } = useSocket();
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
  const [localRemainingSeconds, setLocalRemainingSeconds] = useState(0);

  useEffect(() => {
    fetchSettings();

    // 📡 Standardized Socket listener via useSocket
    const handleRemoteUpdate = (data) => {
      if (data.refreshNeeded) {
        fetchSettings();
        toast.info('تم تحديث إعدادات الولاء من جهاز آخر');
      }
    };

    socket?.on('loyalty:configUpdated', handleRemoteUpdate);
    return () => socket?.off('loyalty:configUpdated', handleRemoteUpdate);
  }, [socket]);

  // 💓 Slow Heartbeat Sync (Every 10 mins) to correct clock drift
  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (!loading) fetchSettings();
    }, 10 * 60 * 1000);
    return () => clearInterval(heartbeat);
  }, [loading]);

  // ⏱️ Countdown Logic
  useEffect(() => {
    if (localRemainingSeconds <= 0) return;
    
    const timer = setInterval(() => {
      setLocalRemainingSeconds(prev => {
        if (prev <= 1) {
          fetchSettings(); // Refresh from server when timer hits zero
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [localRemainingSeconds]);

  const fetchSettings = async () => {
    try {
      const data = unwrap(await api.get('/loyalty/settings'));
      if (data) {
        setSettings(data);
        setLocalRemainingSeconds(data.happyHourStatus?.remainingSeconds || 0);
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
      // 🛡️ Partial Update: Only send editable business fields
      const editableFields = {
        pointsPerJod: parseFloat(settings.pointsPerJod) || 0,
        tierGoldMinOrders: parseInt(settings.tierGoldMinOrders) || 0,
        tierPlatinumMinOrders: parseInt(settings.tierPlatinumMinOrders) || 0,
        pointsMultiplierGold: parseFloat(settings.pointsMultiplierGold) || 1,
        pointsMultiplierPlatinum: parseFloat(settings.pointsMultiplierPlatinum) || 1,
        reviewPoints: parseInt(settings.reviewPoints) || 0,
        referralPoints: parseInt(settings.referralPoints) || 0,
        socialSharePoints: parseInt(settings.socialSharePoints) || 0,
        isHappyHourEnabled: settings.isHappyHourEnabled,
        happyHourMultiplier: parseFloat(settings.happyHourMultiplier) || 1,
        happyHourStart: settings.happyHourStart,
        happyHourEnd: settings.happyHourEnd,
        pointsToJodRate: parseFloat(settings.pointsToJodRate) || 100,
        minPointsToRedeem: parseInt(settings.minPointsToRedeem) || 500
      };

      await api.patch('/loyalty/settings', editableFields);
      toast.success('تم حفظ إعدادات الولاء بنجاح');
      fetchSettings(); // Refresh to get updated countdown/server status
    } catch (error) {
      toast.error('فشل في حفظ التعديلات');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartNow = async () => {
    if (!window.confirm('هل أنت متأكد؟ سيتم تفعيل ساعة السعادة فوراً وإرسال إشعار لجميع العملاء.')) return;
    
    setIsSaving(true);
    try {
      await api.post('/loyalty/start-now');
      toast.success('🚀 بدأت ساعة السعادة! تم إرسال الإشعارات للجميع');
      fetchSettings();
    } catch (error) {
      toast.error('فشل في بدء ساعة السعادة');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStopNow = async () => {
    if (!window.confirm('هل أنت متأكد؟ سيتم إيقاف ساعة السعادة فوراً.')) return;
    
    setIsSaving(true);
    try {
      await api.post('/loyalty/stop-now');
      toast.success('🛑 تم إيقاف ساعة السعادة بنجاح');
      fetchSettings();
    } catch (error) {
      toast.error('فشل في إيقاف ساعة السعادة');
    } finally {
      setIsSaving(false);
    }
  };

  const formatTime = (seconds) => {
    if (seconds <= 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
                title="النقاط مقابل الدينار (للاكتساب)"
                description="عدد النقاط التي يكتسبها العميل مقابل كل 1 دينار مصروف."
                value={settings.pointsPerJod}
                onChange={(val) => setSettings({...settings, pointsPerJod: val})}
                suffix="نقطة / دينار"
              />
              <SettingCard 
                title="قيمة النقاط (للاسترداد)"
                description="عدد النقاط التي تساوي 1 دينار عند الخصم."
                value={settings.pointsToJodRate}
                onChange={(val) => setSettings({...settings, pointsToJodRate: val})}
                suffix="نقطة = 1 دينار"
              />
              <SettingCard 
                title="الحد الأدنى لاستخدام النقاط"
                description="أقل رصيد نقاط مسموح للزبون استخدامه في الطلب."
                value={settings.minPointsToRedeem}
                onChange={(val) => setSettings({...settings, minPointsToRedeem: val})}
                suffix="نقطة"
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
              <p className="text-sm text-slate-300 leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">
                💡 <strong>آلية العمل:</strong> يبدأ جميع الزبائن تلقائياً في <span className="text-slate-400 font-bold">المستوى الفضّي الأساسي</span> بدون أي مضاعفات للرصيد (x1.0). بمجرد إتمام الزبون لعدد معين من الطلبات (مثلاً 10 طلبات)، يقوم النظام <strong>بترقيته تلقائياً</strong> إلى المستوى الذهبي لتسريع كسبه للنقاط، وهكذا للبلاتيني.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Silver Tier (Informational Only) */}
                <div className="bg-white/5 rounded-2xl p-6 border border-white/5 space-y-4 opacity-70">
                  <div className="flex items-center gap-2 text-slate-400">
                    <div className="w-2 h-2 rounded-full bg-slate-400" />
                    <span className="font-bold">المستوى الفضّي (الأساسي)</span>
                  </div>
                  <div className="flex flex-col gap-2 mt-4">
                    <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest">الحد الأدنى للطلبات</label>
                    <div className="text-white font-bold text-sm bg-background border border-white/10 rounded-xl px-3 py-3">
                      مباشرة عند التسجيل
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest">مضاعف النقاط</label>
                    <div className="text-white font-bold text-sm bg-background border border-white/10 rounded-xl px-3 py-3">
                      x1.0 (سرعة عادية)
                    </div>
                  </div>
                </div>

                {/* Gold Tier */}
                <div className="bg-white/5 rounded-2xl p-6 border border-amber-500/20 space-y-4 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform" />
                  <div className="flex items-center gap-2 text-amber-400">
                    <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]" />
                    <span className="font-bold">المستوى الذهبي</span>
                  </div>
                  <div className="mt-4">
                    <SettingInput 
                      label="الطلبات المطلوبة للترقية"
                      value={settings.tierGoldMinOrders}
                      onChange={(val) => setSettings({...settings, tierGoldMinOrders: val})}
                      suffix="طلب"
                    />
                  </div>
                  <SettingInput 
                    label="سرعة كسب النقاط"
                    value={settings.pointsMultiplierGold}
                    onChange={(val) => setSettings({...settings, pointsMultiplierGold: val})}
                    suffix="x"
                    step="0.1"
                  />
                </div>

                {/* Platinum Tier */}
                <div className="bg-white/5 rounded-2xl p-6 border border-blue-400/20 space-y-4 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-400/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform" />
                  <div className="flex items-center gap-2 text-blue-300">
                    <div className="w-2 h-2 rounded-full bg-blue-300 shadow-[0_0_10px_rgba(147,197,253,0.8)]" />
                    <span className="font-bold">المستوى البلاتيني (VIP)</span>
                  </div>
                  <div className="mt-4">
                    <SettingInput 
                      label="الطلبات المطلوبة للترقية"
                      value={settings.tierPlatinumMinOrders}
                      onChange={(val) => setSettings({...settings, tierPlatinumMinOrders: val})}
                      suffix="طلب"
                    />
                  </div>
                  <SettingInput 
                    label="سرعة كسب النقاط"
                    value={settings.pointsMultiplierPlatinum}
                    onChange={(val) => setSettings({...settings, pointsMultiplierPlatinum: val})}
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
              
              <div className="flex items-center gap-6">
                {/* ⏱️ Live Countdown Timer */}
                {settings.isHappyHourEnabled && settings.happyHourStatus?.status === 'ACTIVE' && (
                  <div className="flex items-center gap-3 px-4 py-2 rounded-2xl border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                        ينتهي خلال
                      </span>
                      <span className="font-mono font-bold text-lg leading-none">
                        {formatTime(localRemainingSeconds)}
                      </span>
                    </div>
                  </div>
                )}

                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={settings.isHappyHourEnabled}
                    onChange={async (e) => {
                      const newVal = e.target.checked;
                      setSettings({...settings, isHappyHourEnabled: newVal});
                      // 🚀 Immediate Save for toggles to avoid confusion
                      try {
                        await api.patch('/loyalty/settings', { ...settings, isHappyHourEnabled: newVal });
                        toast.success(newVal ? 'تم تفعيل ساعة السعادة' : 'تم إيقاف ساعة السعادة');
                        fetchSettings();
                      } catch (err) {
                        toast.error('فشل في تحديث الحالة');
                      }
                    }}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>

            <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 transition-opacity duration-300 ${settings.isHappyHourEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <SettingInput 
                label="بداية الوقت"
                value={settings.happyHourStart}
                onChange={(val) => setSettings({...settings, happyHourStart: val})}
                suffix=""
                type="time"
              />
              <div className="flex flex-col gap-2">
                <SettingInput 
                  label="نهاية الوقت"
                  value={settings.happyHourEnd}
                  onChange={(val) => setSettings({...settings, happyHourEnd: val})}
                  suffix=""
                  type="time"
                />
                {/* Quick Presets */}
                <div className="flex gap-2 mt-1">
                    {[1, 2, 3].map(h => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => {
                          // Use server time if available, fallback to local (though server time is preferred)
                          const [sH, sM] = (settings.serverTime || "12:00").split(':').map(Number);
                          const now = new Date();
                          now.setHours(sH, sM, 0, 0);

                          const startStr = settings.serverTime || `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                          
                          const end = new Date(now.getTime() + h * 60 * 60 * 1000);
                          const endStr = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
                          
                          setSettings({
                            ...settings, 
                            happyHourStart: startStr,
                            happyHourEnd: endStr,
                            isHappyHourEnabled: true
                          });
                        }}
                      className="px-2 py-1 text-[9px] font-bold bg-white/5 border border-white/10 rounded-lg hover:bg-primary/20 hover:border-primary/30 transition-all text-text-muted hover:text-white"
                    >
                      {h} ساعة
                    </button>
                  ))}
                </div>
              </div>
              <SettingInput 
                label="مضاعف النقاط"
                value={settings.happyHourMultiplier}
                onChange={(val) => setSettings({...settings, happyHourMultiplier: val})}
                suffix="x"
                step="0.1"
              />
            </div>

            {/* 🚀 Quick Action: Start Now & Notify */}
            <div className="mt-8 pt-8 border-t border-white/5">
              {!settings.isHappyHourEnabled || settings.happyHourStatus?.status !== 'ACTIVE' ? (
                <button
                  onClick={handleStartNow}
                  disabled={isSaving}
                  className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-3 group"
                >
                  <Gift className="w-5 h-5 animate-bounce" />
                  <span>تفعيل "ساعة السعادة" الآن وإرسال تنبيه لجميع العملاء 📢</span>
                </button>
              ) : (
                <button
                  onClick={handleStopNow}
                  disabled={isSaving}
                  className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-3 group"
                >
                  <div className="relative">
                    <Gift className="w-5 h-5" />
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full animate-ping" />
                  </div>
                  <span>إيقاف "ساعة السعادة" الآن (إنهاء العرض) 🛑</span>
                </button>
              )}
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
                onChange={(val) => setSettings({...settings, reviewPoints: val})}
              />
              <EngagementItem 
                icon={<UserPlus className="w-4 h-4" />}
                title="دعوة صديق"
                value={settings.referralPoints}
                onChange={(val) => setSettings({...settings, referralPoints: val})}
              />
              <EngagementItem 
                icon={<Share2 className="w-4 h-4" />}
                title="مشاركة المنتج"
                value={settings.socialSharePoints}
                onChange={(val) => setSettings({...settings, socialSharePoints: val})}
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

const SettingInput = ({ label, value, onChange, suffix, step = "1", type }) => {
  const inputType = type || (typeof value === 'string' && value.includes(':') ? 'text' : 'number');
  
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest">{label}</label>
      <div className="flex items-center gap-2">
        <input 
          type={inputType}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={inputType === 'text' ? 'HH:mm' : ''}
          className="flex-1 bg-background border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-bold outline-none focus:border-primary transition-all [color-scheme:dark]"
        />
        {suffix && <span className="text-[10px] font-bold text-text-muted">{suffix}</span>}
      </div>
    </div>
  );
};

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
