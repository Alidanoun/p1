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


      </div>
    </div>
  );
};

export default BroadcastNotifications;
