import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { Plus, Trash2, UserCheck, History, Search, Filter, X } from 'lucide-react';
import { toast } from 'sonner';
import Customer360 from '../components/Customer360';
import DynamicFieldsRenderer from '../components/DynamicFieldsRenderer';

export default function CRMLeads() {
  const [leads, setLeads] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isConvertingLead, setIsConvertingLead] = useState(false);
  const [leadToConvert, setLeadToConvert] = useState(null);
  const [convertCustomerId, setConvertCustomerId] = useState('');
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', source: 'WEBSITE', notes: '', branchId: '', customFields: {} });
  const [selected360CustomerId, setSelected360CustomerId] = useState(null);
  const [customFieldsDefs, setCustomFieldsDefs] = useState([]);

  useEffect(() => {
    fetchBranches();
    fetchLeads();
    fetchCustomFieldsDefs();
  }, []);

  const fetchBranches = async () => {
    try {
      const res = await api.get('/branch');
      const branchList = res.data?.data || res.data || [];
      setBranches(branchList);
      if (branchList.length > 0) {
        setFormData(prev => ({ ...prev, branchId: branchList[0].id }));
      }
    } catch (err) {
      console.error('Failed to fetch branches', err);
    }
  };

  const fetchCustomFieldsDefs = async () => {
    try {
      const res = await api.get('/crm/custom-fields/definitions/LEAD');
      setCustomFieldsDefs(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to fetch custom field definitions', err);
    }
  };

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
    if (!formData.branchId) {
      toast.error('يرجى تحديد الفرع أولاً');
      return;
    }
    
    try {
      await api.post('/crm/leads', formData, {
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      });
      toast.success('تم إضافة العميل المحتمل بنجاح');
      setShowAddModal(false);
      setFormData({ name: '', phone: '', email: '', source: 'WEBSITE', notes: '', branchId: branches[0]?.id || '', customFields: {} });
      fetchLeads();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || 'فشل في الإضافة');
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

  const handleConvert = (leadId) => {
    setLeadToConvert(leadId);
    setConvertCustomerId('');
    setIsConvertingLead(true);
  };

  const confirmConvert = async () => {
    if (!convertCustomerId) {
      toast.error('يرجى إدخال معرف العميل');
      return;
    }
    
    try {
      await api.post(`/crm/leads/${leadToConvert}/convert`, { customerId: parseInt(convertCustomerId) });
      toast.success('تم تحويل العميل المحتمل إلى عميل دائم بنجاح!');
      setIsConvertingLead(false);
      setLeadToConvert(null);
      fetchLeads();
    } catch (err) {
      console.error('Error converting lead:', err);
      const errorMessage = err.response?.data?.error?.message || err.response?.data?.message || 'حدث خطأ أثناء عملية التحويل';
      toast.error(errorMessage);
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      NEW: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600',
      CONTACTED: 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
      QUALIFIED: 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      CONVERTED: 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      LOST: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
    };
    const labels = {
      NEW: 'جديد',
      CONTACTED: 'تم التواصل',
      QUALIFIED: 'مؤهل',
      CONVERTED: 'مُحول (عميل)',
      LOST: 'مفقود'
    };
    return (
      <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${styles[status] || styles.NEW}`}>
        {labels[status] || 'غير محدد'}
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-slate-100">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-800 p-6 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">العملاء المحتملين (Leads)</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">إدارة ومتابعة سجل العملاء المحتملين والبيانات الأولية.</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors text-sm font-medium shadow-sm">
            <Filter size={16} /> تصفية
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 rounded-md transition-colors text-sm font-medium shadow-sm"
          >
            <Plus size={16} /> إضافة سجل جديد
          </button>
        </div>
      </div>

      {/* Leads Data Table */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50/50 dark:bg-slate-900/50">
          <div className="relative w-full max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
            <input 
              type="text" 
              placeholder="البحث بالاسم، الرقم..." 
              className="w-full pl-4 pr-10 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent transition-shadow text-slate-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-400"
            />
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-600">
            إجمالي السجلات: {leads.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
                <th className="px-6 py-4 text-slate-600 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">اسم العميل المحتمل</th>
                <th className="px-6 py-4 text-slate-600 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">المصدر</th>
                <th className="px-6 py-4 text-slate-600 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">الحالة</th>
                <th className="px-6 py-4 text-slate-600 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">تاريخ الإنشاء</th>
                <th className="px-6 py-4 text-slate-600 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center text-slate-500 dark:text-slate-400 text-sm">جاري تحميل البيانات...</td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center text-slate-500 dark:text-slate-400 text-sm">لا توجد سجلات مطابقة.</td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center text-xs font-bold shrink-0">
                          {lead.name ? lead.name.substring(0, 2) : 'N/A'}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{lead.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[200px]">{lead.notes || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded border border-gray-200 dark:border-slate-600">
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(lead.status)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                      {new Date(lead.createdAt).toLocaleDateString('ar-IQ')}
                    </td>
                    <td className="px-6 py-4 text-left">
                      <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        {lead.status !== 'CONVERTED' && (
                          <button
                            onClick={() => handleConvert(lead.id)}
                            title="تحويل لعميل دائم"
                            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
                          >
                            <UserCheck size={18} />
                          </button>
                        )}
                        {lead.status === 'CONVERTED' && lead.convertedCustomerId && (
                          <button
                            onClick={() => setSelected360CustomerId(lead.convertedCustomerId)}
                            title="عرض السجل الشامل 360°"
                            className="p-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
                          >
                            <History size={18} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(lead.id)}
                          title="حذف السجل"
                          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors ml-1"
                        >
                          <Trash2 size={18} />
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

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">إضافة عميل محتمل جديد</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <form id="leadForm" onSubmit={handleAddLead} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">الاسم الكامل *</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="اسم العميل" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">رقم الجوال</label>
                    <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="07xxxxxx" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">الفرع *</label>
                    <select required value={formData.branchId} onChange={(e) => setFormData({ ...formData, branchId: e.target.value })} className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                      {branches.length === 0 && <option value="">جاري التحميل...</option>}
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">المصدر</label>
                  <select value={formData.source} onChange={(e) => setFormData({ ...formData, source: e.target.value })} className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    <option value="WEBSITE">الموقع الإلكتروني</option>
                    <option value="FACEBOOK">فيسبوك</option>
                    <option value="INSTAGRAM">انستغرام</option>
                    <option value="WALK_IN">زيارة الفرع</option>
                    <option value="CALL">اتصال هاتفي</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">ملاحظات إضافية</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white" rows="2" placeholder="ملاحظات حول طلب العميل..."></textarea>
                </div>
                {customFieldsDefs.length > 0 && (
                  <div className="pt-4 mt-2 border-t border-gray-200 dark:border-slate-700">
                    <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wide">البيانات الإضافية</h4>
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-md border border-gray-200 dark:border-slate-700">
                      <DynamicFieldsRenderer definitions={customFieldsDefs} values={formData.customFields} onChange={(key, val) => setFormData(prev => ({ ...prev, customFields: { ...prev.customFields, [key]: val } }))} />
                    </div>
                  </div>
                )}
              </form>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 flex justify-end gap-3 rounded-b-lg">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors">إلغاء</button>
              <button type="submit" form="leadForm" className="px-4 py-2 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 rounded-md text-sm font-medium shadow-sm transition-colors">حفظ السجل</button>
            </div>
          </div>
        </div>
      )}

      {/* Convert Lead Modal */}
      {isConvertingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600/10 rounded-lg">
                  <UserCheck className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white">تحويل لعميل دائم</h2>
              </div>
              <button onClick={() => { setIsConvertingLead(false); setLeadToConvert(null); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">لربط هذا العميل المحتمل بحساب عميل فعلي في النظام، يرجى إدخال معرف العميل (Customer ID) أدناه:</p>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">معرف العميل (Customer ID) <span className="text-red-500">*</span></label>
                <input type="number" required value={convertCustomerId} onChange={(e) => setConvertCustomerId(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-800 dark:text-white" placeholder="مثال: 105" />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50/50 dark:bg-gray-800/50">
              <button type="button" onClick={() => { setIsConvertingLead(false); setLeadToConvert(null); }} className="px-6 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium transition-colors">إلغاء</button>
              <button type="button" onClick={confirmConvert} disabled={!convertCustomerId} className="px-6 py-2.5 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl font-medium shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <UserCheck size={18} /> إتمام التحويل
              </button>
            </div>
          </div>
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
