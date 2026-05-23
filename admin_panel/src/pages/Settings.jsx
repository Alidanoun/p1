import { useState, useEffect } from 'react';
import { Save, MessageCircle, Bell, Shield, Settings as SettingsIcon, Clock, Phone, MapPin, Image as ImageIcon, Plus, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/Header';
import { cn } from '../lib/utils';
import Switch from '../components/Switch';
import api, { unwrap } from '../api/client';

const DAYS = [
  { id: 6, label: 'السبت' },
  { id: 0, label: 'الأحد' },
  { id: 1, label: 'الإثنين' },
  { id: 2, label: 'الثلاثاء' },
  { id: 3, label: 'الأربعاء' },
  { id: 4, label: 'الخميس' },
  { id: 5, label: 'الجمعة' },
];

const Settings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  const [settings, setSettings] = useState({
    restaurantName: 'مطعم المركزية',
    announcementText: '',
    phone: '',
    whatsapp: '',
    address: '',
    minOrderValue: '0',
    notificationsEnabled: true,
    autoAcceptOrders: false,
    logoUrl: '/logo.png', // Default to the app logo
  });

  const [schedule, setSchedule] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const [credentials, setCredentials] = useState({
    email: '',
    currentPassword: '',
    newPassword: ''
  });
  const [updatingCredentials, setUpdatingCredentials] = useState(false);

  const [branchCredentials, setBranchCredentials] = useState({
    branchId: '',
    email: '',
    newPassword: ''
  });
  const [branches, setBranches] = useState([]);
  const [updatingBranch, setUpdatingBranch] = useState(false);

  const DEFAULT_PERMISSION_MATRIX = {
    liveOrders: 'FULL',
    manageOrders: 'FULL',
    menu: 'FULL',
    notifications: 'FULL',
    reviews: 'VIEW',
    loyalty: 'VIEW',
    rewardsStore: 'NONE',
    advancedAnalytics: 'VIEW',
    financials: 'VIEW',
    deliveryZones: 'EDIT_PIN',
    auditLog: 'VIEW',
    settings: 'EDIT_PIN',
    canToggleLiveMode: false,
    canModifyWorkHours: 'EDIT_PIN'
  };

  const [newBranch, setNewBranch] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    managerEmail: '',
    managerPassword: '',
    managerPin: '',
    visibleInApp: true,
    appDisplayOrder: 0,
    allowedPermissions: { ...DEFAULT_PERMISSION_MATRIX }
  });

  const [selectedEditBranchId, setSelectedEditBranchId] = useState('');
  const [editBranchPermissions, setEditBranchPermissions] = useState({ ...DEFAULT_PERMISSION_MATRIX });
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);

  useEffect(() => {
    if (!selectedEditBranchId) return;

    const fetchPermissions = async () => {
      setLoadingPermissions(true);
      try {
        const response = await api.get(`/branch/${selectedEditBranchId}/permissions`);
        const result = unwrap(response);
        if (result) {
          setEditBranchPermissions(result);
        }
      } catch (error) {
        toast.error('فشل في جلب صلاحيات الفرع');
      } finally {
        setLoadingPermissions(false);
      }
    };

    fetchPermissions();
  }, [selectedEditBranchId]);

  const [advancedConfig, setAdvancedConfig] = useState({
    business: {},
    security: {}
  });
  const [lastFetchTime, setLastFetchTime] = useState(0);

  const fetchData = async () => {
    try {
      const [settingsData, scheduleData, logsData, sysConfigData, branchesData] = await Promise.all([
        api.get('/settings').then(unwrap).catch(() => ({})),
        api.get('/restaurant/schedule').then(unwrap).catch(() => ({ schedule: [] })),
        api.get('/settings/audit').then(unwrap).catch(() => []),
        api.get('/system/config').then(unwrap).catch(() => null),
        api.get('/branch').then(unwrap).catch(() => [])
      ]);
      
      if (settingsData) {
        setSettings(prev => ({ ...prev, ...settingsData }));
        setLastFetchTime(Date.now());
      }

      if (branchesData && branchesData.length > 0) {
        setBranches(branchesData);
        setBranchCredentials(prev => ({ ...prev, branchId: branchesData[0].id }));
        setSelectedEditBranchId(branchesData[0].id);
      }
      
      if (scheduleData && scheduleData.schedule) {
        const fullSchedule = DAYS.map(d => {
          const existing = scheduleData.schedule.find(s => s.dayOfWeek === d.id);
          return existing || { dayOfWeek: d.id, openTime: '09:00', closeTime: '23:00', isClosed: false };
        });
        setSchedule(fullSchedule);
      }
      
      if (logsData) {
        setAuditLogs(logsData);
      }

      if (sysConfigData) {
        setAdvancedConfig(sysConfigData);
      }
    } catch (error) {
      toast.error('فشل في تحميل الإعدادات');
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveSettings = async () => {
    setUpdating(true);
    try {
      await api.put('/settings', { settings, lastFetchTime });
      
      if (activeTab === 'schedule') {
        await api.post('/restaurant/schedule', { schedule });
      }
      
      toast.success('تم حفظ التغييرات بنجاح');
    } catch (error) {
      const message = error.response?.data?.error || 'فشل في الحفظ';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveAdvancedConfig = async (type) => {
    setUpdating(true);
    try {
      await api.patch('/settings/advanced', { 
        type, 
        data: advancedConfig[type] 
      });
      toast.success('تم تحديث الإعدادات المتقدمة بنجاح');
    } catch (error) {
      toast.error('فشل في تحديث الإعدادات المتقدمة');
    } finally {
      setUpdating(false);
    }
  };

  const copyToAllDays = (sourceDay) => {
    setSchedule(prev => prev.map(day => ({
      ...day,
      openTime: sourceDay.openTime,
      closeTime: sourceDay.closeTime,
      isClosed: sourceDay.isClosed
    })));
    toast.success('تم نسخ الأوقات لجميع الأيام');
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('حجم الصورة يجب أن لا يتجاوز 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setSettings({ ...settings, logoUrl: reader.result });
      toast.success('تم رفع الشعار بنجاح! لا تنسَ حفظ التغييرات.');
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateCredentials = async (e) => {
    e.preventDefault();
    if (!credentials.currentPassword) {
      toast.error('يجب إدخال كلمة المرور الحالية لتأكيد التغييرات');
      return;
    }
    
    setUpdatingCredentials(true);
    try {
      await api.put('/settings/credentials', credentials);
      toast.success('تم تحديث بيانات الدخول بنجاح');
      setCredentials({ email: '', currentPassword: '', newPassword: '' });
      fetchData(); // Refresh logs
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل في تحديث بيانات الدخول');
    } finally {
      setUpdatingCredentials(false);
    }
  };

  const handleUpdateBranchCredentials = async (e) => {
    e.preventDefault();
    if (!branchCredentials.newPassword || branchCredentials.newPassword.length < 6) {
      toast.error('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    setUpdatingBranch(true);
    try {
      await api.put('/settings/branch-credentials', branchCredentials);
      toast.success('تم تحديث بيانات الفرع بنجاح');
      setBranchCredentials({ ...branchCredentials, email: '', newPassword: '' });
      // Refresh logs
      const logsData = await api.get('/settings/audit').then(unwrap).catch(() => []);
      setAuditLogs(Array.isArray(logsData) ? logsData : []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل في تحديث بيانات الفرع');
    } finally {
      setUpdatingBranch(false);
    }
  };

  const handleCreateBranch = async (e) => {
    e.preventDefault();
    if (newBranch.managerPin.length !== 4 || isNaN(newBranch.managerPin)) {
      toast.error('يجب أن يكون رمز PIN مكوناً من 4 أرقام');
      return;
    }
    setCreatingBranch(true);
    try {
      await api.post('/branch', newBranch);
      toast.success('تم إنشاء الفرع ومديره وصلاحياته بنجاح');
      // Reset form
      setNewBranch({
        name: '',
        code: '',
        address: '',
        phone: '',
        managerEmail: '',
        managerPassword: '',
        managerPin: '',
        visibleInApp: true,
        appDisplayOrder: 0,
        allowedPermissions: { ...DEFAULT_PERMISSION_MATRIX }
      });
      // Refresh branches list
      const branchesData = await api.get('/branch').then(unwrap).catch(() => []);
      setBranches(branchesData);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل في إنشاء الفرع');
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleUpdateBranchPermissions = async (e) => {
    e.preventDefault();
    if (!selectedEditBranchId) {
      toast.error('يرجى تحديد فرع أولاً');
      return;
    }
    setSavingPermissions(true);
    try {
      await api.put(`/branch/${selectedEditBranchId}/permissions`, { allowedPermissions: editBranchPermissions });
      toast.success('تم تحديث صلاحيات الفرع لجميع المستخدمين وتطهير الكاش');
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل في تحديث صلاحيات الفرع');
    } finally {
      setSavingPermissions(false);
    }
  };

  const tabs = [
    { id: 'general', title: 'الهوية والأسعار', icon: MapPin },
    { id: 'schedule', title: 'أوقات العمل', icon: Clock },
    { id: 'contact', title: 'التواصل والإعلانات', icon: Bell },
    { id: 'security', title: 'الأمان والسجلات', icon: Shield },
    { id: 'advanced', title: 'إعدادات النظام', icon: SettingsIcon },
  ];

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20 overflow-hidden font-sans">
      <Header 
        title="إعدادات المنظومة" 
        subtitle="تحكم في هوية مطعمك، أوقات العمل، وكافة الميزات" 
      />

      <div className="flex flex-col lg:flex-row gap-8 mt-6">
        
        {/* Settings Navigation Sidebar */}
        <div className="lg:w-64 flex flex-col gap-3">
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

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col xl:flex-row gap-8">
          
          {/* Settings Form Column */}
          <div className="flex-1 bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 p-8 shadow-2xl relative overflow-hidden group">
            <div className="absolute inset-x-0 -top-px h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent transition-opacity opacity-0 group-hover:opacity-100" />
            
            <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary">
                  {(() => {
                    const ActiveIcon = tabs.find(t => t.id === activeTab)?.icon;
                    return ActiveIcon ? <ActiveIcon className="w-6 h-6" /> : null;
                  })()}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    {tabs.find(t => t.id === activeTab)?.title}
                  </h2>
                  <p className="text-text-muted text-xs font-medium mt-1">تعديلات سريعة وفعّالة للحفاظ على كفاءة المطعم</p>
                </div>
              </div>
              <button 
                onClick={handleSaveSettings}
                disabled={updating}
                className="glass-button flex items-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50"
              >
                {updating ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{updating ? 'جاري الحفظ...' : 'حفظ التغييرات'}</span>
              </button>
            </div>

            <div className="space-y-8 animate-in fade-in duration-500">
              
              {/* TAB: GENERAL (Cards Layout) */}
              {activeTab === 'general' && (
                <div className="space-y-6">
                  {/* Card: Identity */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-6">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                      <MapPin className="w-5 h-5 text-primary" /> هوية المطعم
                    </h3>
                    
                    <div className="flex items-center gap-8">
                      <label className="w-24 h-24 bg-background border border-white/10 rounded-3xl flex items-center justify-center relative overflow-hidden group cursor-pointer hover:border-primary/50 transition-all shadow-sm">
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={handleLogoUpload}
                        />
                        {settings.logoUrl ? (
                          <img src={settings.logoUrl} alt="Restaurant Logo" className="w-full h-full object-contain p-2" />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-text-muted opacity-20" />
                        )}
                        <div className="absolute inset-0 bg-primary/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                          <span className="text-xs font-bold text-white uppercase">تغيير الشعار</span>
                        </div>
                      </label>
                      <div className="flex-1 space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">اسم المطعم (الذي يظهر للزبون)</label>
                        <input 
                          type="text" 
                          className="glass-input text-right w-full" 
                          value={settings.restaurantName || ''} 
                          placeholder="مثال: مطعم المركزية"
                          onChange={e => setSettings({...settings, restaurantName: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card: Operations */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-6">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                      <SettingsIcon className="w-5 h-5 text-primary" /> إعدادات التشغيل
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">الحد الأدنى للطلب (دينار)</label>
                        <input 
                          type="number" 
                          step="0.1"
                          className="glass-input text-right w-full text-xl font-mono" 
                          value={settings.minOrderValue || ''} 
                          onChange={e => setSettings({...settings, minOrderValue: e.target.value})}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-background/50 rounded-2xl border border-white/5 mt-4">
                      <div>
                        <p className="font-bold text-white text-sm">القبول التلقائي للطلبات</p>
                        <p className="text-text-muted text-xs mt-1">عند التفعيل، لن تحتاج لقبول الطلبات يدوياً، ستنتقل للمطبخ فوراً.</p>
                      </div>
                      <Switch 
                        checked={settings.autoAcceptOrders === true || settings.autoAcceptOrders === 'true'} 
                        onChange={val => setSettings({...settings, autoAcceptOrders: val})} 
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: SCHEDULE (Weekly Grid) */}
              {activeTab === 'schedule' && (
                <div className="space-y-4">
                  <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
                    <Clock className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-primary">الأتمتة الذكية مفعلة</p>
                      <p className="text-xs text-primary/80 mt-1">سيقوم النظام بفتح وإغلاق المطعم تلقائياً بناءً على هذا الجدول ولن يضطر الموظف للتدخل.</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {schedule.map((day, index) => {
                      const dayName = DAYS.find(d => d.id === day.dayOfWeek)?.label || 'يوم';
                      return (
                        <div key={day.dayOfWeek} className={cn(
                          "flex items-center justify-between p-4 rounded-2xl border transition-all",
                          day.isClosed ? "bg-red-500/5 border-red-500/20" : "bg-white/5 border-white/10"
                        )}>
                          <div className="w-24">
                            <span className={cn("font-bold", day.isClosed ? "text-red-400" : "text-white")}>{dayName}</span>
                          </div>
                          
                          <div className="flex-1 flex items-center justify-center gap-4">
                            {day.isClosed ? (
                              <span className="text-sm font-bold text-red-500 bg-red-500/10 px-4 py-2 rounded-xl">مغلق بالكامل</span>
                            ) : (
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] text-text-muted text-center">الفتح</span>
                                  <input 
                                    type="time" 
                                    value={day.openTime}
                                    onChange={(e) => {
                                      const newSched = [...schedule];
                                      newSched[index].openTime = e.target.value;
                                      setSchedule(newSched);
                                    }}
                                    className="glass-input !py-2 !px-3 font-mono text-sm w-28 text-center bg-background/50"
                                  />
                                </div>
                                <span className="text-text-muted mt-5">-</span>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] text-text-muted text-center">الإغلاق</span>
                                  <input 
                                    type="time" 
                                    value={day.closeTime}
                                    onChange={(e) => {
                                      const newSched = [...schedule];
                                      newSched[index].closeTime = e.target.value;
                                      setSchedule(newSched);
                                    }}
                                    className="glass-input !py-2 !px-3 font-mono text-sm w-28 text-center bg-background/50"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-4 w-40 justify-end">
                            <Switch 
                              checked={!day.isClosed} 
                              onChange={(val) => {
                                const newSched = [...schedule];
                                newSched[index].isClosed = !val;
                                setSchedule(newSched);
                              }} 
                            />
                            {index === 0 && (
                              <button 
                                onClick={() => copyToAllDays(day)}
                                className="p-2 hover:bg-primary/20 text-primary rounded-lg transition-colors group relative"
                                title="تطبيق على كل الأيام"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* TAB: CONTACT & ANNOUNCEMENTS */}
              {activeTab === 'contact' && (
                <div className="space-y-6">
                  {/* Card: Announcements */}
                  <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 space-y-4">
                    <h3 className="text-lg font-bold text-amber-500 flex items-center gap-2">
                      <Bell className="w-5 h-5" /> شريط الإعلانات العاجلة
                    </h3>
                    <p className="text-xs text-text-muted">هذا النص سيظهر في شريط متحرك أعلى التطبيق للفت انتباه الزبائن.</p>
                    <textarea 
                      className="glass-input text-right w-full min-h-[80px] py-4 bg-background/50 placeholder:text-text-muted/30" 
                      placeholder="مثال: خصم 20% على جميع الوجبات بمناسبة الافتتاح!"
                      value={settings.announcementText || ''} 
                      onChange={e => setSettings({...settings, announcementText: e.target.value})}
                    />
                  </div>

                  {/* Card: Support */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-6">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                      <Phone className="w-5 h-5 text-emerald-500" /> أرقام الدعم السريع
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">رقم الهاتف الأساسي</label>
                        <div className="relative">
                          <Phone className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500/50" />
                          <input 
                            type="text" 
                            className="glass-input pr-11 text-right w-full" 
                            placeholder="079..."
                            value={settings.phone || ''} 
                            onChange={e => setSettings({...settings, phone: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted pr-1">رقم الواتساب</label>
                        <div className="relative">
                          <MessageCircle className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                          <input 
                            type="text" 
                            className="glass-input pr-11 text-right w-full" 
                            placeholder="079..."
                            value={settings.whatsapp || ''} 
                            onChange={e => setSettings({...settings, whatsapp: e.target.value})}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: SECURITY & AUDIT */}
              {activeTab === 'security' && (
                <div className="space-y-6">
                  {/* Card: Change Credentials */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                      <Shield className="w-5 h-5 text-emerald-500" /> تغيير بيانات الدخول (المدير)
                    </h3>
                    
                    <form onSubmit={handleUpdateCredentials} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-text-muted pr-1">البريد الإلكتروني الجديد (اختياري)</label>
                          <input 
                            type="email" 
                            className="glass-input text-right w-full" 
                            placeholder="اتركه فارغاً إذا لم ترد تغييره"
                            value={credentials.email} 
                            onChange={e => setCredentials({...credentials, email: e.target.value})}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-text-muted pr-1">كلمة المرور الجديدة (اختياري)</label>
                          <input 
                            type="password" 
                            className="glass-input text-right w-full font-mono placeholder:font-sans" 
                            placeholder="••••••••"
                            value={credentials.newPassword} 
                            onChange={e => setCredentials({...credentials, newPassword: e.target.value})}
                          />
                        </div>
                      </div>

                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl mt-4">
                        <label className="text-xs font-bold text-red-400 pr-1 flex items-center gap-2 mb-2">
                          <Shield className="w-4 h-4" /> تأكيد الهوية (مطلوب)
                        </label>
                        <div className="flex items-center gap-4">
                          <input 
                            type="password" 
                            required
                            className="glass-input text-right flex-1 font-mono placeholder:font-sans" 
                            placeholder="أدخل كلمة المرور الحالية"
                            value={credentials.currentPassword} 
                            onChange={e => setCredentials({...credentials, currentPassword: e.target.value})}
                          />
                          <button 
                            type="submit"
                            disabled={updatingCredentials}
                            className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-xl transition-all disabled:opacity-50"
                          >
                            {updatingCredentials ? 'جاري التحديث...' : 'تحديث البيانات'}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                  {/* Card: Create New Branch */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                      <Plus className="w-5 h-5 text-emerald-500" /> إنشاء فرع جديد ومدير للفرع
                    </h3>

                    <form onSubmit={handleCreateBranch} className="space-y-6">
                      <div className="bg-background/30 p-4 rounded-xl space-y-4">
                        <h4 className="text-sm font-bold text-white mb-2">1. معلومات الفرع الأساسية</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">اسم الفرع</label>
                            <input 
                              type="text" 
                              required
                              className="glass-input text-right w-full" 
                              placeholder="مثال: فرع عمان الغربية"
                              value={newBranch.name} 
                              onChange={e => setNewBranch({...newBranch, name: e.target.value})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">كود الفرع (فريد)</label>
                            <input 
                              type="text" 
                              required
                              className="glass-input text-right w-full font-mono placeholder:font-sans" 
                              placeholder="مثال: AMM-WEST"
                              value={newBranch.code} 
                              onChange={e => setNewBranch({...newBranch, code: e.target.value.toUpperCase().trim()})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">العنوان</label>
                            <input 
                              type="text" 
                              className="glass-input text-right w-full" 
                              placeholder="شارع المدينة المنورة، بناء 10"
                              value={newBranch.address} 
                              onChange={e => setNewBranch({...newBranch, address: e.target.value})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">رقم الهاتف</label>
                            <input 
                              type="text" 
                              className="glass-input text-right w-full font-mono placeholder:font-sans" 
                              placeholder="07XXXXXXXX"
                              value={newBranch.phone} 
                              onChange={e => setNewBranch({...newBranch, phone: e.target.value})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">ظهور الفرع في التطبيق</label>
                            <select 
                              className="glass-input text-right w-full bg-background"
                              value={newBranch.visibleInApp ? 'true' : 'false'}
                              onChange={e => setNewBranch({...newBranch, visibleInApp: e.target.value === 'true'})}
                            >
                              <option value="true">مفعّل ويظهر للزبائن</option>
                              <option value="false">مخفي عن الزبائن</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">ترتيب الظهور في التطبيق</label>
                            <input 
                              type="number" 
                              className="glass-input text-right w-full font-mono" 
                              value={newBranch.appDisplayOrder} 
                              onChange={e => setNewBranch({...newBranch, appDisplayOrder: parseInt(e.target.value) || 0})}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="bg-background/30 p-4 rounded-xl space-y-4">
                        <h4 className="text-sm font-bold text-white mb-2">2. معلومات حساب مدير الفرع والـ PIN</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">البريد الإلكتروني للمدير</label>
                            <input 
                              type="email" 
                              required
                              className="glass-input text-right w-full" 
                              placeholder="manager@example.com"
                              value={newBranch.managerEmail} 
                              onChange={e => setNewBranch({...newBranch, managerEmail: e.target.value})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">كلمة مرور الحساب</label>
                            <input 
                              type="password" 
                              required
                              className="glass-input text-right w-full font-mono placeholder:font-sans" 
                              placeholder="••••••••"
                              value={newBranch.managerPassword} 
                              onChange={e => setNewBranch({...newBranch, managerPassword: e.target.value})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-text-muted pr-1">رمز PIN للمدير (4 أرقام)</label>
                            <input 
                              type="password" 
                              required
                              maxLength={4}
                              className="glass-input text-right w-full font-mono placeholder:font-sans" 
                              placeholder="1234"
                              value={newBranch.managerPin} 
                              onChange={e => setNewBranch({...newBranch, managerPin: e.target.value.replace(/\D/g, '')})}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="bg-background/30 p-4 rounded-xl space-y-4">
                        <h4 className="text-sm font-bold text-white mb-2">3. 🔒 تحديد صلاحيات الفرع (Permissions Matrix)</h4>
                        
                        <div className="overflow-x-auto">
                          <table className="w-full text-right text-sm">
                            <thead>
                              <tr className="bg-white/5 text-text-muted text-xs border-b border-white/5">
                                <th className="p-3 font-bold text-right">اسم الوحدة</th>
                                <th className="p-3 font-bold text-center">وصول كامل (FULL)</th>
                                <th className="p-3 font-bold text-center">تعديل بـ PIN (EDIT_PIN)</th>
                                <th className="p-3 font-bold text-center">قفل بـ PIN للقراءة والتعديل (EDIT_PIN_READ)</th>
                                <th className="p-3 font-bold text-center">مشاهدة فقط (VIEW)</th>
                                <th className="p-3 font-bold text-center">إخفاء وحظر (NONE)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                { key: 'liveOrders', label: 'الطلبات الحية (Live Orders)' },
                                { key: 'manageOrders', label: 'إدارة الطلبات والتحضير (Manage Orders)' },
                                { key: 'menu', label: 'قائمة المنتجات والمنيو (Menu)' },
                                { key: 'notifications', label: 'بث الإشعارات والتنبيهات (Notifications)' },
                                { key: 'reviews', label: 'إدارة التقييمات (Reviews)' },
                                { key: 'loyalty', label: 'إدارة برنامج الولاء والعملاء (Loyalty)' },
                                { key: 'rewardsStore', label: 'متجر المكافآت للزبائن (Rewards Store)' },
                                { key: 'advancedAnalytics', label: 'التقارير والإحصائيات المتقدمة' },
                                { key: 'financials', label: 'المالية والتقارير المالية (Financials)' },
                                { key: 'deliveryZones', label: 'مناطق التوصيل ورسومها (Delivery Zones)' },
                                { key: 'auditLog', label: 'سجلات النشاط والتدقيق (Audit Log)' },
                                { key: 'settings', label: 'إعدادات الفرع وساعات الدوام (Settings)' },
                                { key: 'canModifyWorkHours', label: 'تعديل أوقات وساعات العمل' }
                              ].map(item => (
                                <tr key={item.key} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="p-3 text-white font-bold">{item.label}</td>
                                  <td className="p-3 text-center">
                                    <input 
                                      type="radio" 
                                      name={`new_${item.key}`} 
                                      value="FULL" 
                                      checked={newBranch.allowedPermissions[item.key] === 'FULL'} 
                                      onChange={() => setNewBranch({
                                        ...newBranch, 
                                        allowedPermissions: { ...newBranch.allowedPermissions, [item.key]: 'FULL' }
                                      })} 
                                    />
                                  </td>
                                  <td className="p-3 text-center">
                                    <input 
                                      type="radio" 
                                      name={`new_${item.key}`} 
                                      value="EDIT_PIN" 
                                      checked={newBranch.allowedPermissions[item.key] === 'EDIT_PIN'} 
                                      onChange={() => setNewBranch({
                                        ...newBranch, 
                                        allowedPermissions: { ...newBranch.allowedPermissions, [item.key]: 'EDIT_PIN' }
                                      })} 
                                    />
                                  </td>
                                  <td className="p-3 text-center">
                                    <input 
                                      type="radio" 
                                      name={`new_${item.key}`} 
                                      value="EDIT_PIN_READ" 
                                      checked={newBranch.allowedPermissions[item.key] === 'EDIT_PIN_READ'} 
                                      onChange={() => setNewBranch({
                                        ...newBranch, 
                                        allowedPermissions: { ...newBranch.allowedPermissions, [item.key]: 'EDIT_PIN_READ' }
                                      })} 
                                    />
                                  </td>
                                  <td className="p-3 text-center">
                                    <input 
                                      type="radio" 
                                      name={`new_${item.key}`} 
                                      value="VIEW" 
                                      checked={newBranch.allowedPermissions[item.key] === 'VIEW'} 
                                      onChange={() => setNewBranch({
                                        ...newBranch, 
                                        allowedPermissions: { ...newBranch.allowedPermissions, [item.key]: 'VIEW' }
                                      })} 
                                    />
                                  </td>
                                  <td className="p-3 text-center">
                                    <input 
                                      type="radio" 
                                      name={`new_${item.key}`} 
                                      value="NONE" 
                                      checked={newBranch.allowedPermissions[item.key] === 'NONE'} 
                                      onChange={() => setNewBranch({
                                        ...newBranch, 
                                        allowedPermissions: { ...newBranch.allowedPermissions, [item.key]: 'NONE' }
                                      })} 
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="flex items-center justify-between border-t border-white/5 pt-4">
                          <div>
                            <span className="text-white text-sm font-bold block">ميزة الإغلاق العاجل والبث المباشر (Emergency Mode)</span>
                            <span className="text-text-muted text-xs">تتيح للفرع إغلاق الطلبات في الحالات الطارئة وتغيير حالة البث المباشر فوراً</span>
                          </div>
                          <Switch 
                            checked={newBranch.allowedPermissions.canToggleLiveMode} 
                            onChange={checked => setNewBranch({
                              ...newBranch, 
                              allowedPermissions: { ...newBranch.allowedPermissions, canToggleLiveMode: checked }
                            })} 
                          />
                        </div>
                      </div>

                      <div className="flex justify-end mt-4">
                        <button 
                          type="submit"
                          disabled={creatingBranch}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-8 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          {creatingBranch ? 'جاري إنشاء الفرع...' : 'إنشاء الفرع ومدير الفرع'}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Card: Edit Existing Branch Permissions */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                      <Shield className="w-5 h-5 text-indigo-500" /> تعديل صلاحيات الفروع الحالية
                    </h3>

                    <form onSubmit={handleUpdateBranchPermissions} className="space-y-6">
                      <div className="space-y-2 mb-4">
                        <label className="text-xs font-bold text-text-muted pr-1">تحديد الفرع للمراجعة والتعديل</label>
                        <select 
                          className="glass-input text-right w-full bg-background font-bold text-white"
                          value={selectedEditBranchId}
                          onChange={e => setSelectedEditBranchId(e.target.value)}
                        >
                          {branches.map(branch => (
                            <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>
                          ))}
                          {branches.length === 0 && (
                            <option value="">لا يوجد فروع مسجلة</option>
                          )}
                        </select>
                      </div>

                      {loadingPermissions ? (
                        <div className="p-8 text-center text-text-muted flex justify-center items-center gap-2">
                          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          <span>جاري تحميل مصفوفة الصلاحيات الحالية للفرع...</span>
                        </div>
                      ) : (
                        <div className="bg-background/30 p-4 rounded-xl space-y-4">
                          <h4 className="text-sm font-bold text-white mb-2">صلاحيات الوصول الديناميكية الحالية للفرع</h4>
                          
                          <div className="overflow-x-auto">
                            <table className="w-full text-right text-sm">
                              <thead>
                                <tr className="bg-white/5 text-text-muted text-xs border-b border-white/5">
                                  <th className="p-3 font-bold text-right">اسم الوحدة</th>
                                  <th className="p-3 font-bold text-center">وصول كامل (FULL)</th>
                                  <th className="p-3 font-bold text-center">مشاهدة وتعديل بـ PIN</th>
                                  <th className="p-3 font-bold text-center">مشاهدة فقط (VIEW)</th>
                                  <th className="p-3 font-bold text-center">إخفاء وحظر (NONE)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  { key: 'liveOrders', label: 'الطلبات الحية (Live Orders)' },
                                  { key: 'manageOrders', label: 'إدارة الطلبات والتحضير (Manage Orders)' },
                                  { key: 'menu', label: 'قائمة المنتجات والمنيو (Menu)' },
                                  { key: 'notifications', label: 'بث الإشعارات والتنبيهات (Notifications)' },
                                  { key: 'reviews', label: 'إدارة التقييمات (Reviews)' },
                                  { key: 'loyalty', label: 'إدارة برنامج الولاء والعملاء (Loyalty)' },
                                  { key: 'rewardsStore', label: 'متجر المكافآت للزبائن (Rewards Store)' },
                                  { key: 'advancedAnalytics', label: 'التقارير والإحصائيات المتقدمة' },
                                  { key: 'financials', label: 'المالية والتقارير المالية (Financials)' },
                                  { key: 'deliveryZones', label: 'مناطق التوصيل ورسومها (Delivery Zones)' },
                                  { key: 'auditLog', label: 'سجلات النشاط والتدقيق (Audit Log)' },
                                  { key: 'settings', label: 'إعدادات الفرع وساعات الدوام (Settings)' },
                                  { key: 'canModifyWorkHours', label: 'تعديل أوقات وساعات العمل' }
                                ].map(item => (
                                  <tr key={item.key} className="border-b border-white/5 hover:bg-white/5">
                                    <td className="p-3 text-white font-bold">{item.label}</td>
                                    <td className="p-3 text-center">
                                      <input 
                                        type="radio" 
                                        name={`edit_${item.key}`} 
                                        value="FULL" 
                                        checked={editBranchPermissions[item.key] === 'FULL'} 
                                        onChange={() => setEditBranchPermissions({
                                          ...editBranchPermissions, 
                                          [item.key]: 'FULL'
                                        })} 
                                      />
                                    </td>
                                    <td className="p-3 text-center">
                                      <input 
                                        type="radio" 
                                        name={`edit_${item.key}`} 
                                        value="EDIT_PIN" 
                                        checked={editBranchPermissions[item.key] === 'EDIT_PIN'} 
                                        onChange={() => setEditBranchPermissions({
                                          ...editBranchPermissions, 
                                          [item.key]: 'EDIT_PIN'
                                        })} 
                                      />
                                    </td>
                                    <td className="p-3 text-center">
                                      <input 
                                        type="radio" 
                                        name={`edit_${item.key}`} 
                                        value="EDIT_PIN_READ" 
                                        checked={editBranchPermissions[item.key] === 'EDIT_PIN_READ'} 
                                        onChange={() => setEditBranchPermissions({
                                          ...editBranchPermissions, 
                                          [item.key]: 'EDIT_PIN_READ'
                                        })} 
                                      />
                                    </td>
                                    <td className="p-3 text-center">
                                      <input 
                                        type="radio" 
                                        name={`edit_${item.key}`} 
                                        value="VIEW" 
                                        checked={editBranchPermissions[item.key] === 'VIEW'} 
                                        onChange={() => setEditBranchPermissions({
                                          ...editBranchPermissions, 
                                          [item.key]: 'VIEW'
                                        })} 
                                      />
                                    </td>
                                    <td className="p-3 text-center">
                                      <input 
                                        type="radio" 
                                        name={`edit_${item.key}`} 
                                        value="NONE" 
                                        checked={editBranchPermissions[item.key] === 'NONE'} 
                                        onChange={() => setEditBranchPermissions({
                                          ...editBranchPermissions, 
                                          [item.key]: 'NONE'
                                        })} 
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="flex items-center justify-between border-t border-white/5 pt-4">
                            <div>
                              <span className="text-white text-sm font-bold block">ميزة الإغلاق العاجل والبث المباشر (Emergency Mode)</span>
                              <span className="text-text-muted text-xs">تتيح للفرع إغلاق الطلبات في الحالات الطارئة وتغيير حالة البث المباشر فوراً</span>
                            </div>
                            <Switch 
                              checked={!!editBranchPermissions.canToggleLiveMode} 
                              onChange={checked => setEditBranchPermissions({
                                ...editBranchPermissions, 
                                canToggleLiveMode: checked
                              })} 
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end mt-4">
                        <button 
                          type="submit"
                          disabled={savingPermissions || loadingPermissions || !selectedEditBranchId}
                          className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 px-8 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          {savingPermissions ? 'جاري حفظ التغييرات...' : 'حفظ وتحديث الصلاحيات'}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Card: Logs */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                      <Shield className="w-5 h-5 text-blue-500" /> إدارة حسابات الفروع
                    </h3>
                    
                    <form onSubmit={handleUpdateBranchCredentials} className="space-y-4">
                      <div className="space-y-2 mb-4">
                        <label className="text-xs font-bold text-text-muted pr-1">تحديد الفرع</label>
                        <select 
                          className="glass-input text-right w-full bg-background"
                          value={branchCredentials.branchId}
                          onChange={e => setBranchCredentials({...branchCredentials, branchId: e.target.value})}
                        >
                          {branches.map(branch => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                          ))}
                          {branches.length === 0 && (
                            <option value="">لا يوجد فروع مسجلة</option>
                          )}
                        </select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-text-muted pr-1">البريد الإلكتروني للفرع (اختياري)</label>
                          <input 
                            type="email" 
                            className="glass-input text-right w-full" 
                            placeholder="اتركه فارغاً إذا لم ترد تغييره"
                            value={branchCredentials.email} 
                            onChange={e => setBranchCredentials({...branchCredentials, email: e.target.value})}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-text-muted pr-1">كلمة المرور الجديدة (إلزامي)</label>
                          <input 
                            type="password" 
                            required
                            className="glass-input text-right w-full font-mono placeholder:font-sans" 
                            placeholder="••••••••"
                            value={branchCredentials.newPassword} 
                            onChange={e => setBranchCredentials({...branchCredentials, newPassword: e.target.value})}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end mt-4">
                        <button 
                          type="submit"
                          disabled={updatingBranch}
                          className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-xl transition-all disabled:opacity-50"
                        >
                          {updatingBranch ? 'جاري التحديث...' : 'تحديث بيانات الفرع'}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Card: Logs */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Clock className="w-5 h-5 text-primary" /> سجل نشاطات النظام
                      </h3>
                      <span className="text-xs text-text-muted bg-white/5 px-3 py-1 rounded-full">آخر 20 عملية</span>
                    </div>
                    
                    <div className="bg-background/50 rounded-xl overflow-hidden border border-white/5">
                      {auditLogs.length > 0 ? (
                        <table className="w-full text-right text-sm">
                          <thead>
                            <tr className="bg-white/5 text-text-muted text-xs border-b border-white/5">
                              <th className="p-4 font-medium">الإجراء</th>
                              <th className="p-4 font-medium">المستخدم</th>
                              <th className="p-4 font-medium">الوقت</th>
                            </tr>
                          </thead>
                          <tbody>
                            {auditLogs.map(log => (
                              <tr key={log.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                                <td className="p-4 text-white font-mono text-xs">{log.action}</td>
                                <td className="p-4 text-emerald-400">{log.userRole || 'Admin'}</td>
                                <td className="p-4 text-text-muted text-xs" dir="ltr">
                                  {new Date(log.createdAt).toLocaleString('en-GB')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="p-8 text-center text-text-muted text-sm">لا توجد سجلات متاحة</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: ADVANCED CONFIG (Dynamic Business Rules) */}
              {activeTab === 'advanced' && (
                <div className="space-y-6">
                  {/* Security Policy Section */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Shield className="w-5 h-5 text-red-500" /> سياسة الحماية والأمان
                      </h3>
                      <button 
                        onClick={() => handleSaveAdvancedConfig('security')}
                        className="text-xs bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl transition-all font-bold"
                      >
                        حفظ سياسة الأمان
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="flex flex-col gap-2 h-full">
                        <label className="text-xs font-bold text-text-muted mb-auto">محاولات الدخول الفاشلة</label>
                        <input 
                          type="number" 
                          className="glass-input text-center w-full" 
                          value={advancedConfig.security?.maxLoginAttempts || 5} 
                          onChange={e => setAdvancedConfig({
                            ...advancedConfig, 
                            security: { ...advancedConfig.security, maxLoginAttempts: parseInt(e.target.value) }
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-2 h-full">
                        <label className="text-xs font-bold text-text-muted mb-auto">مدة القفل (دقيقة)</label>
                        <input 
                          type="number" 
                          className="glass-input text-center w-full" 
                          value={advancedConfig.security?.lockDurationMinutes || 15} 
                          onChange={e => setAdvancedConfig({
                            ...advancedConfig, 
                            security: { ...advancedConfig.security, lockDurationMinutes: parseInt(e.target.value) }
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-2 h-full">
                        <label className="text-xs font-bold text-text-muted mb-auto">تأخير الحماية (ms)</label>
                        <input 
                          type="number" 
                          className="glass-input text-center w-full" 
                          value={advancedConfig.security?.timingDelayMs || 300} 
                          onChange={e => setAdvancedConfig({
                            ...advancedConfig, 
                            security: { ...advancedConfig.security, timingDelayMs: parseInt(e.target.value) }
                          })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Business Rules Section */}
                  <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <SettingsIcon className="w-5 h-5 text-primary" /> قواعد العمل والقيود
                      </h3>
                      <button 
                        onClick={() => handleSaveAdvancedConfig('business')}
                        className="text-xs bg-primary/10 text-primary hover:bg-primary hover:text-white px-4 py-2 rounded-xl transition-all font-bold"
                      >
                        حفظ قواعد العمل
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="flex flex-col gap-2 h-full">
                        <label className="text-xs font-bold text-text-muted mb-auto">أقصى طول لسبب الإلغاء (حرف)</label>
                        <input 
                          type="number" 
                          className="glass-input text-center w-full" 
                          value={advancedConfig.business?.maxCancellationReasonLength || 500} 
                          onChange={e => setAdvancedConfig({
                            ...advancedConfig, 
                            business: { ...advancedConfig.business, maxCancellationReasonLength: parseInt(e.target.value) }
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-2 h-full">
                        <label className="text-xs font-bold text-text-muted mb-auto">الحد الأقصى للتقييم</label>
                        <input 
                          type="number" 
                          className="glass-input text-center w-full" 
                          value={advancedConfig.business?.maxRating || 5} 
                          onChange={e => setAdvancedConfig({
                            ...advancedConfig, 
                            business: { ...advancedConfig.business, maxRating: parseInt(e.target.value) }
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-2 h-full">
                        <label className="text-xs font-bold text-text-muted mb-auto">مُعامل أوقات الذروة (Peak Multiplier)</label>
                        <input 
                          type="number" 
                          step="0.1"
                          className="glass-input text-center w-full" 
                          value={advancedConfig.business?.peakMultiplier || 1.0} 
                          onChange={e => setAdvancedConfig({
                            ...advancedConfig, 
                            business: { ...advancedConfig.business, peakMultiplier: parseFloat(e.target.value) }
                          })}
                        />
                      </div>
                    </div>

                    {/* 💰 Tax Rate Setting */}
                    <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-4 mt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-white text-sm flex items-center gap-2">
                            💰 نسبة ضريبة المبيعات
                          </p>
                          <p className="text-text-muted text-xs mt-1">
                            النسبة المئوية للضريبة المضمنة في أسعار المنتجات. يتم استخدامها لاستخراج الضريبة من الإجمالي في الفواتير والتقارير المالية.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 flex-1">
                          <input 
                            type="number" 
                            step="1"
                            min="0"
                            max="100"
                            className="glass-input text-center w-24 text-xl font-mono font-bold" 
                            value={Math.round((advancedConfig.business?.taxRate || 0.16) * 100)} 
                            onChange={e => {
                              const percent = parseFloat(e.target.value);
                              if (!isNaN(percent) && percent >= 0 && percent <= 100) {
                                setAdvancedConfig({
                                  ...advancedConfig, 
                                  business: { ...advancedConfig.business, taxRate: percent / 100 }
                                });
                              }
                            }}
                          />
                          <span className="text-sm font-bold text-amber-400">%</span>
                        </div>
                        <div className="text-[10px] text-text-muted bg-white/5 px-3 py-2 rounded-xl border border-white/5">
                          القيمة المخزنة: <span className="font-mono text-amber-400 font-bold">{advancedConfig.business?.taxRate || 0.16}</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-amber-400/70 flex items-start gap-1.5 mt-1">
                        <span>⚠️</span>
                        <span>تغيير هذه القيمة يؤثر مباشرة على حساب الضريبة في جميع الطلبات الجديدة والتقارير المالية. تأكد من صحة القيمة قبل الحفظ.</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-background/50 rounded-2xl border border-white/5 mt-4">
                      <div>
                        <p className="font-bold text-white text-sm">التحديث التلقائي للوجبات الأكثر طلباً</p>
                        <p className="text-text-muted text-xs mt-1">عند التفعيل، سيقوم النظام بحساب وتحديث الوجبات الأكثر طلباً تلقائياً بناءً على المبيعات الحقيقية.</p>
                      </div>
                      <Switch 
                        checked={advancedConfig.business?.autoFeaturedMode === true} 
                        onChange={val => setAdvancedConfig({
                          ...advancedConfig, 
                          business: { ...advancedConfig.business, autoFeaturedMode: val }
                        })} 
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Live Preview Phone Frame (Only visible on larger screens) */}
          <div className="hidden xl:flex w-[350px] shrink-0 flex-col items-center">
            <h3 className="text-sm font-bold text-text-muted mb-4 flex items-center gap-2 uppercase tracking-widest">
              <Smartphone className="w-4 h-4" /> Live Preview
            </h3>
            
            {/* Phone Mockup Wrapper */}
            <div className="relative w-[320px] h-[650px] bg-black rounded-[45px] shadow-2xl shadow-primary/20 border-[8px] border-gray-900 overflow-hidden ring-1 ring-white/10">
              
              {/* Notch */}
              <div className="absolute top-0 inset-x-0 h-6 bg-gray-900 rounded-b-3xl w-40 mx-auto z-50"></div>
              
              {/* App Interface */}
              <div className="absolute inset-0 bg-[#f8fafc] dark:bg-[#0f172a] flex flex-col pt-12">
                
                {/* Announcement Bar */}
                {settings.announcementText && (
                  <div className="bg-amber-500 text-white text-xs font-bold py-2 px-4 text-center truncate">
                    {settings.announcementText}
                  </div>
                )}
                
                {/* Header Mockup */}
                <div className="bg-white dark:bg-[#1e293b] p-4 shadow-sm flex flex-col items-center pt-6 pb-6 rounded-b-3xl z-10 relative">
                  
                  {/* Status Badge */}
                  {activeTab === 'schedule' ? (
                     <div className="absolute top-4 right-4 bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-full animate-pulse">
                        الدوام مفعّل
                     </div>
                  ) : null}

                  {/* Logo Placeholder */}
                  <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-3 shadow-inner overflow-hidden border border-gray-200 dark:border-gray-700">
                    {settings.logoUrl ? (
                      <img src={settings.logoUrl} alt="Logo Preview" className="w-full h-full object-contain p-1" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-400" />
                    )}
                  </div>
                  
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                    {settings.restaurantName || 'اسم المطعم'}
                  </h1>
                  
                  <div className="flex gap-4 mt-4 w-full">
                    <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-2 text-center">
                      <p className="text-[10px] text-gray-500">التوصيل</p>
                      <p className="text-sm font-bold text-emerald-500 mt-1">
                        حسب المنطقة
                      </p>
                    </div>
                    <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-2 text-center">
                      <p className="text-[10px] text-gray-500">الحد الأدنى</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                        {settings.minOrderValue} JOD
                      </p>
                    </div>
                  </div>
                </div>

                {/* Skeleton Content */}
                <div className="flex-1 p-4 space-y-4 opacity-50">
                  <div className="w-1/3 h-4 bg-gray-200 dark:bg-gray-800 rounded-full"></div>
                  <div className="flex gap-3 overflow-hidden">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="w-24 h-24 shrink-0 bg-gray-200 dark:bg-gray-800 rounded-2xl"></div>
                    ))}
                  </div>
                  <div className="space-y-3 mt-6">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="w-full h-20 bg-gray-200 dark:bg-gray-800 rounded-2xl"></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
};

export default Settings;
