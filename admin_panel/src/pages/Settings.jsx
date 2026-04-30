import { useState, useEffect } from 'react';
import { Save, MessageCircle, Bell, Shield, Settings as SettingsIcon, Clock, Phone, MapPin, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/Header';
import { cn } from '../lib/utils';
import Switch from '../components/Switch';
import api, { unwrap } from '../api/client';

const Settings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [settings, setSettings] = useState({
     restaurantName: '',
     phone: '',
     whatsapp: '',
     address: '',
     openingHours: '',
     deliveryFee: '0',
     currency: 'JOD',
     notificationsEnabled: true,
     autoAcceptOrders: false,
     logo: null
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = unwrap(await api.get('/settings'));
        if (data) {
          // Merge fetched settings with default state
          setSettings(prev => ({
            ...prev,
            ...data
          }));
        }
      } catch (error) {
        toast.error('فشل في تحميل الإعدادات');
        console.error('Fetch settings error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
     setUpdating(true);
     try {
        await api.put('/settings', settings);
        toast.success('تم حفظ التغييرات بنجاح');
     } catch (error) {
        const message = error.response?.data?.error || 'فشل في حفظ التغييرات';
        toast.error(message);
     } finally {
        setUpdating(false);
     }
  };

  const tabs = [
     { id: 'general', title: 'عامة', icon: SettingsIcon },
     { id: 'contact', title: 'اتصال', icon: MessageCircle },
     { id: 'notifications', title: 'إشعارات', icon: Bell },
     { id: 'security', title: 'أمان', icon: Shield },
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20 overflow-hidden">
      <Header 
        title="إعدادات المتجر" 
        subtitle="تحكم في هوية مطعمك، وكافة ميزات النظام" 
      />

      <div className="flex flex-col lg:flex-row gap-8">
         {/* Settings Navigation */}
         <div className="lg:w-64 space-y-2">
            {tabs.map((tab) => (
               <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                     "w-full flex items-center gap-3 px-5 py-4 rounded-2xl border transition-all duration-300 font-bold",
                     activeTab === tab.id 
                     ? "bg-primary text-white border-primary shadow-lg shadow-primary/20 scale-[1.02]" 
                     : "bg-card/40 text-text-muted border-white/5 hover:bg-white/5 hover:text-white"
                  )}
               >
                  <tab.icon className="w-5 h-5" />
                  <span>{tab.title}</span>
               </button>
            ))}
         </div>

         {/* Settings Content Area */}
         <div className="flex-1 bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 p-8 shadow-2xl relative overflow-hidden group">
            <div className="absolute inset-x-0 -top-px h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent transition-opacity opacity-0 group-hover:opacity-100" />
            
            <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-6">
                <div>
                  <h2 className="text-xl font-bold font-mono text-white tracking-tight flex items-center gap-3">
                     {tabs.find(t => t.id === activeTab).title}
                  </h2>
                  <p className="text-text-muted text-xs font-bold mt-1 uppercase tracking-widest opacity-50 text-right">تعديلات سريعة وفعّالة</p>
                </div>
                <button 
                   onClick={handleSave}
                   disabled={updating}
                   className="glass-button flex items-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50"
                >
                   {updating ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                   <span>{updating ? 'جاري الحفظ' : 'حفظ التعديلات'}</span>
                </button>
            </div>

            <div className="space-y-8 animate-in fade-in duration-500">
               {activeTab === 'general' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="md:col-span-2 flex items-center gap-8 mb-4">
                        <div className="w-24 h-24 bg-background border border-white/10 rounded-3xl flex items-center justify-center relative overflow-hidden group cursor-pointer">
                           <ImageIcon className="w-8 h-8 text-text-muted opacity-20" />
                           <div className="absolute inset-0 bg-primary/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-xs font-bold text-white uppercase tracking-widest">رفع شعار</span>
                           </div>
                        </div>
                        <div>
                           <h3 className="font-bold text-white text-lg">شعار المطعم</h3>
                           <p className="text-text-muted text-xs">يفضل أن يكون بخلفية شفافة PNG</p>
                        </div>
                     </div>

                     <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">اسم المطعم (عربي/إنجليزي)</label>
                        <input 
                           type="text" 
                           className="glass-input text-right" 
                           value={settings.restaurantName} 
                           onChange={e => setSettings({...settings, restaurantName: e.target.value})}
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">ساعات العمل</label>
                        <div className="relative">
                           <Clock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                           <input 
                              type="text" 
                              className="glass-input pr-11 text-right" 
                              value={settings.openingHours} 
                              onChange={e => setSettings({...settings, openingHours: e.target.value})}
                           />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">رسوم التوصيل (JOD)</label>
                        <input 
                           type="number" 
                           step="0.1"
                           className="glass-input text-right" 
                           value={settings.deliveryFee} 
                           onChange={e => setSettings({...settings, deliveryFee: e.target.value})}
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">الحد الأدنى للطلب (JOD)</label>
                        <input 
                           type="number" 
                           step="0.1"
                           className="glass-input text-right" 
                           value={settings.minOrderValue} 
                           onChange={e => setSettings({...settings, minOrderValue: e.target.value})}
                        />
                     </div>
                     <div className="md:col-span-2 space-y-4 pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between p-4 bg-background/50 rounded-2xl border border-white/5">
                           <div>
                              <p className="font-bold text-white text-sm">قبول الطلبات تلقائياً</p>
                              <p className="text-text-muted text-[10px]">تفعيل هذه الميزة سيجعل جميع الطلبات الجدد تنتقل مباشرة لقيد التجهيز</p>
                           </div>
                           <Switch 
                              checked={!!settings.autoAcceptOrders} 
                              onChange={val => setSettings({...settings, autoAcceptOrders: val})} 
                           />
                        </div>
                     </div>
                  </div>
               )}

               {activeTab === 'contact' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">رقم الهاتف الأساسي</label>
                        <div className="relative">
                           <Phone className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                           <input 
                              type="text" 
                              className="glass-input pr-11 text-right" 
                              value={settings.phone || ''} 
                              onChange={e => setSettings({...settings, phone: e.target.value})}
                           />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">واتساب المبيعات</label>
                        <div className="relative">
                           <MessageCircle className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                           <input 
                              type="text" 
                              className="glass-input pr-11 text-right" 
                              value={settings.whatsapp || ''} 
                              onChange={e => setSettings({...settings, whatsapp: e.target.value})}
                           />
                        </div>
                     </div>
                     <div className="md:col-span-2 space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">العنوان بالتفصيل</label>
                        <div className="relative">
                           <MapPin className="absolute right-4 top-4 w-4 h-4 text-rose-500" />
                           <textarea 
                              className="glass-input pr-11 text-right min-h-[100px] py-4" 
                              value={settings.address || ''} 
                              onChange={e => setSettings({...settings, address: e.target.value})}
                           />
                        </div>
                     </div>
                  </div>
               )}

               {activeTab === 'notifications' && (
                  <div className="space-y-6">
                     <div className="flex items-center justify-between p-6 bg-background/40 rounded-3xl border border-white/5 group-hover:border-primary/20 transition-all">
                        <div className="flex items-center gap-4">
                           <div className="p-3 bg-primary/10 rounded-2xl text-primary"><Bell className="w-6 h-6" /></div>
                           <div>
                              <p className="font-bold text-white">إشعارات المتصفح</p>
                              <p className="text-text-muted text-[10px]">تلقي تنبيهات عند وصول طلبات جديدة</p>
                           </div>
                        </div>
                        <Switch checked={settings.notificationsEnabled} onChange={val => setSettings({...settings, notificationsEnabled: val})} />
                     </div>
                  </div>
               )}

               {activeTab === 'security' && (
                  <div className="space-y-6 text-right">
                     <p className="text-text-muted text-sm italic">سيتم إضافة خيارات الأمان قريباً لدعم تعدد المستخدمين.</p>
                  </div>
               )}
            </div>
         </div>
      </div>
    </div>
  );
};

export default Settings;
