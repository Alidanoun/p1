import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { Plus, Phone, Mail, Trash2, RefreshCw, ArrowRight, UserCheck, History } from 'lucide-react';
import { toast } from 'sonner';
import Customer360 from '../components/Customer360';

export default function CRMLeads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', source: 'WEBSITE', notes: '' });
  const [selected360CustomerId, setSelected360CustomerId] = useState(null);

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const res = await api.get('/crm/leads');
      const data = res.data?.data?.leads || res.data?.leads || [];
      setLeads(data);
    } catch (err) {
      toast.error('فشل في جلب العملاء المحتملين');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLead = async (e) => {
    e.preventDefault();
    try {
      await api.post('/crm/leads', formData);
      toast.success('تم إضافة العميل المحتمل بنجاح');
      setShowAddModal(false);
      setFormData({ name: '', phone: '', email: '', source: 'WEBSITE', notes: '' });
      fetchLeads();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل في الإضافة');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا العميل؟')) return;
    try {
      await api.delete(`/crm/leads/${id}`);
      toast.success('تم حذف العميل بنجاح');
      fetchLeads();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل في الحذف');
    }
  };

  const handleConvert = async (leadId) => {
    try {
      const customerId = parseInt(window.prompt('أدخل معرف العميل (Customer ID) المسجل ليتم ربطه:'));
      if (!customerId) return;
      
      await api.post(`/crm/leads/${leadId}/convert`, { customerId });
      toast.success('تم تحويل العميل المحتمل بنجاح');
      fetchLeads();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل في التحويل');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/50 backdrop-blur-md p-6 rounded-3xl border border-white/20 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">العملاء المحتملين (Leads)</h1>
          <p className="text-gray-500 mt-1">إدارة ومتابعة العملاء المحتملين قبل تحويلهم إلى مشترين</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-2xl flex items-center gap-2 transition-all shadow-lg shadow-primary/30"
        >
          <Plus /> إضافة عميل محتمل
        </button>
      </div>

      {/* Leads Table */}
      <div className="bg-white/70 backdrop-blur-xl rounded-3xl border border-white/40 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="p-4 text-gray-600 font-semibold">الاسم</th>
                <th className="p-4 text-gray-600 font-semibold">المصدر</th>
                <th className="p-4 text-gray-600 font-semibold">الحالة</th>
                <th className="p-4 text-gray-600 font-semibold">تاريخ الإضافة</th>
                <th className="p-4 text-gray-600 font-semibold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-gray-500">جاري التحميل...</td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-gray-500">لا يوجد عملاء محتملين حالياً</td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-gray-50 hover:bg-white/60 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-gray-800">{lead.name}</div>
                      <div className="text-xs text-gray-500 mt-1">{lead.notes || 'لا يوجد ملاحظات'}</div>
                    </td>
                    <td className="p-4">
                      <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm font-medium">
                        {lead.source}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        lead.status === 'NEW' ? 'bg-green-50 text-green-600' :
                        lead.status === 'CONVERTED' ? 'bg-purple-50 text-purple-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {lead.status === 'NEW' ? 'جديد' : 
                         lead.status === 'CONTACTED' ? 'تم التواصل' :
                         lead.status === 'QUALIFIED' ? 'مؤهل' :
                         lead.status === 'CONVERTED' ? 'مُحول (عميل)' : 'مفقود'}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-gray-600">
                      {new Date(lead.createdAt).toLocaleDateString('ar-IQ')}
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        {lead.status !== 'CONVERTED' && (
                          <button
                            onClick={() => handleConvert(lead.id)}
                            title="تحويل إلى عميل مسجل"
                            className="p-2 bg-purple-50 text-purple-600 hover:bg-purple-100 rounded-xl transition-colors"
                          >
                            <UserCheck />
                          </button>
                        )}
                        {lead.status === 'CONVERTED' && lead.convertedCustomerId && (
                          <button
                            onClick={() => setSelected360CustomerId(lead.convertedCustomerId)}
                            title="عرض ملف العميل 360°"
                            className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl transition-colors"
                          >
                            <History />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(lead.id)}
                          title="حذف"
                          className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl transition-colors"
                        >
                          <Trash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl p-8 w-full max-w-md shadow-2xl border border-white">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">إضافة عميل محتمل</h2>
            <form onSubmit={handleAddLead} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  placeholder="محمد أحمد"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">رقم الجوال</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="0790000000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المصدر</label>
                <select
                  value={formData.source}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  className="w-full border-gray-200 bg-white/50 rounded-xl p-3 outline-none"
                >
                  <option value="WEBSITE">الموقع الإلكتروني</option>
                  <option value="FACEBOOK">فيسبوك</option>
                  <option value="INSTAGRAM">انستغرام</option>
                  <option value="WALK_IN">زيارة الفرع</option>
                  <option value="CALL">اتصال هاتفي</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full border-gray-200 bg-white/50 rounded-xl p-3 outline-none"
                  rows="3"
                ></textarea>
              </div>
              
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white transition-colors"
                >
                  حفظ العميل
                </button>
              </div>
            </form>
        </div>
      )}

      <Customer360 
        customerId={selected360CustomerId} 
        isOpen={selected360CustomerId !== null} 
        onClose={() => setSelected360CustomerId(null)} 
      />
    </div>
  );
}
