import React, { useState } from 'react';
import { Send, CheckCircle, Smartphone, Users } from 'lucide-react';
import Header from '../components/Header';
import api from '../api/client';

const BroadcastNotifications = () => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleBroadcast = async (e) => {
    e.preventDefault();
    if (!title || !message) {
      toast.error('يرجى تعبئة العنوان والرسالة');
      return;
    }

    setLoading(true);
    try {
      await api.post('/notifications/broadcast', { title, message });
      
      toast.success('تم إرسال الإشعار بنجاح لجميع المستخدمين!');
      setTitle('');
      setMessage('');
    } catch (err) {
      console.error('Broadcast error:', err);
      toast.error(err.response?.data?.error || 'حدث خطأ أثناء الإرسال');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      <Header title="إرسال إشعارات وعروض" subtitle="التواصل مع جميع العملاء في نفس اللحظة" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <form onSubmit={handleBroadcast} className="bg-card/40 border border-white/5 rounded-2xl p-6 backdrop-blur-md h-fit">
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Send className="w-5 h-5 text-primary" /> إرسال إشعار عام
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">عنوان الإشعار (مثال: 🥳 خصم 50% اليوم فقط)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-background border border-slate-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="اكتب العنوان هنا..."
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2">محتوى الرسالة التفصيلي</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                className="w-full bg-background border border-slate-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none transition-all"
                placeholder="مرحباً، لدينا عرض جديد لك..."
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-xl transition-all shadow-lg hover:shadow-primary/20 flex items-center justify-center gap-2 mt-6 active:scale-[0.98]"
            >
              {loading ? <span className="animate-pulse">جاري الإرسال...</span> : <><Send className="w-5 h-5" /> إرسال لجميع العملاء فوراً</>}
            </button>
          </div>
        </form>

        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-4 relative overflow-hidden h-fit xl:h-[500px]">
          <div className="absolute opacity-5 -right-10 -bottom-10"><Smartphone className="w-64 h-64" /></div>

          <div className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-[2rem] p-4 pb-8 shadow-2xl relative z-10 transition-all hover:-translate-y-2 duration-300">
            <div className="w-16 h-1 bg-slate-700 rounded-full mx-auto mb-6"></div>

            {/* Mobile screen mock */}
            <div className="h-64 bg-slate-800 rounded-xl relative overflow-hidden">
              <div className="absolute top-0 w-full p-3 flex flex-col gap-2">
                <div className="bg-slate-700 w-full h-8 rounded-lg opacity-20"></div>
                <div className="bg-slate-700 w-3/4 h-8 rounded-lg opacity-20"></div>
              </div>

              {/* Notification Toast Mock */}
              <div className="absolute top-4 left-0 right-0 px-3 z-20 transition-all duration-500 animate-in fade-in slide-in-from-top-12">
                <div className="bg-[#1e293b]/90 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-[0_8px_30px_rgb(0,0,0,0.3)] text-right">
                  <div className="flex items-center gap-2 mb-1 text-primary text-[10px] font-bold">
                    المركزية <CheckCircle className="w-3 h-3" />
                  </div>
                  <h4 className="text-white font-bold text-sm tracking-wide leading-tight">{title || 'عنوان الإشعار...'}</h4>
                  <p className="text-slate-300 text-xs mt-1 leading-snug">{message || 'سيظهر محتوى الرسالة هنا للمستخدمين...'}</p>
                </div>
              </div>
            </div>

            <div className="w-1/3 h-1 bg-slate-700 rounded-full mx-auto mt-4"></div>
          </div>

          <div className="relative z-10 bg-background/50 p-4 rounded-xl backdrop-blur border border-white/5 mt-6">
            <h3 className="text-white font-bold text-lg flex justify-center items-center gap-2"><Users className="text-primary w-5 h-5" /> معاينة حية للتنبيه</h3>
            <p className="text-slate-400 text-sm mt-2 max-w-sm leading-relaxed">
              هذا الإشعار سيصل كرسالة منبثقة ملفتة للإنتباه لكل عميل يتصفح التطبيق في هذه اللحظة، وسيبقى ثابتاً في قائمة إشعاراته دائماً.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BroadcastNotifications;
