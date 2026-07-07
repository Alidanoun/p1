import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { Plus, Trash2, Edit3, Settings, Shield, Building, ToggleLeft, ToggleRight, List, Check, X } from 'lucide-react';
import { toast } from 'sonner';

const FIELD_TYPES = [
  { id: 'TEXT', label: 'نص (Text)' },
  { id: 'NUMBER', label: 'رقم (Number)' },
  { id: 'DATE', label: 'تاريخ (Date)' },
  { id: 'SELECT', label: 'قائمة خيارات (Select)' },
  { id: 'BOOLEAN', label: 'نعم / لا (Boolean)' }
];

export default function CustomFieldsManager() {
  const [entityType, setEntityType] = useState('LEAD');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [branches, setBranches] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  
  const [formData, setFormData] = useState({
    key: '',
    label: '',
    fieldType: 'TEXT',
    optionsText: '', // for SELECT options, comma-separated
    isRequired: false,
    order: 0,
    branchId: ''
  });

  const [editFormData, setEditFormData] = useState({
    id: null,
    label: '',
    fieldType: 'TEXT',
    optionsText: '',
    isRequired: false,
    order: 0,
    isActive: true
  });

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchDefinitions();
  }, [entityType, selectedBranchId]);

  const fetchBranches = async () => {
    try {
      const res = await api.get('/branch');
      const branchList = res.data?.data || res.data || [];
      setBranches(branchList);
    } catch (err) {
      toast.error('فشل في جلب الفروع');
    }
  };

  const fetchDefinitions = async () => {
    try {
      setLoading(true);
      const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const res = await api.get(`/crm/custom-fields/definitions/${entityType}${branchParam}`);
      const data = res.data?.data || res.data || [];
      setDefinitions(data);
    } catch (err) {
      toast.error('فشل في جلب الحقول المخصصة');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDefinition = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        entityType,
        key: formData.key,
        label: formData.label,
        fieldType: formData.fieldType,
        isRequired: formData.isRequired,
        order: Number(formData.order || 0),
        branchId: formData.branchId || null,
        options: formData.fieldType === 'SELECT' 
          ? formData.optionsText.split(',').map(s => s.trim()).filter(Boolean)
          : null
      };

      await api.post('/crm/custom-fields/definitions', payload);
      toast.success('تم إنشاء الحقل المخصص بنجاح');
      setShowAddModal(false);
      setFormData({
        key: '',
        label: '',
        fieldType: 'TEXT',
        optionsText: '',
        isRequired: false,
        order: 0,
        branchId: ''
      });
      fetchDefinitions();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل في إنشاء الحقل');
    }
  };

  const handleEditDefinition = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        label: editFormData.label,
        fieldType: editFormData.fieldType,
        isRequired: editFormData.isRequired,
        order: Number(editFormData.order || 0),
        isActive: editFormData.isActive,
        options: editFormData.fieldType === 'SELECT'
          ? editFormData.optionsText.split(',').map(s => s.trim()).filter(Boolean)
          : null
      };

      await api.patch(`/crm/custom-fields/definitions/${editFormData.id}`, payload);
      toast.success('تم تحديث الحقل المخصص بنجاح');
      setShowEditModal(false);
      fetchDefinitions();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل في تحديث الحقل');
    }
  };

  const handleSoftDelete = async (id) => {
    if (!window.confirm('هل أنت متأكد من تعطيل/حذف هذا الحقل المخصص؟ سيتم الاحتفاظ بالبيانات القديمة ولكن لن يظهر في الاستمارات مجدداً.')) return;
    try {
      await api.delete(`/crm/custom-fields/definitions/${id}`);
      toast.success('تم تعطيل/حذف الحقل بنجاح');
      fetchDefinitions();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل الإجراء');
    }
  };

  const openEditModal = (def) => {
    const opts = Array.isArray(def.options) ? def.options.join(', ') : '';
    setEditFormData({
      id: def.id,
      label: def.label,
      fieldType: def.fieldType,
      optionsText: opts,
      isRequired: def.isRequired,
      order: def.order,
      isActive: def.isActive
    });
    setShowEditModal(true);
  };

  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/50 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-3xl border border-white/20 dark:border-slate-700 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Settings className="text-primary animate-spin-slow" />
            إدارة الحقول المخصصة (Custom Fields)
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">تخصيص استمارات العملاء المحتملين والصفقات لكل فرع برمجياً</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-2xl flex items-center gap-2 transition-all shadow-lg shadow-primary/30"
        >
          <Plus size={20} /> إضافة حقل مخصص
        </button>
      </div>

      {/* Filters bar */}
      <div className="bg-white/60 dark:bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">الكيان (Entity Type)</label>
          <div className="flex gap-2">
            <button
              onClick={() => setEntityType('LEAD')}
              className={`flex-1 py-2 px-4 rounded-xl font-bold transition-all ${
                entityType === 'LEAD'
                  ? 'bg-primary text-white shadow-md shadow-primary/25'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              عميل محتمل (Lead)
            </button>
            <button
              onClick={() => setEntityType('OPPORTUNITY')}
              className={`flex-1 py-2 px-4 rounded-xl font-bold transition-all ${
                entityType === 'OPPORTUNITY'
                  ? 'bg-primary text-white shadow-md shadow-primary/25'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              صفقة / فرصة مبيعات (Opportunity)
            </button>
          </div>
        </div>

        <div className="w-full md:w-72">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">الفرع (Branch Context)</label>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-2.5 outline-none"
          >
            <option value="">كافة الفروع (عام)</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Definitions Table */}
      <div className="bg-white/70 dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl border border-white/40 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400 font-medium">جاري تحميل حقول الكيان المخصصة...</div>
        ) : definitions.length === 0 ? (
          <div className="p-12 text-center text-gray-400 dark:text-gray-500">لا توجد حقول مخصصة معرّفة لهذا الفلتر حالياً.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-gray-50/50 dark:bg-slate-900/50 border-b border-gray-100 dark:border-slate-700">
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold">المسمى المعروض</th>
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold">المفتاح التقني (Key)</th>
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold">نوع الحقل</th>
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold">الفرع</th>
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold">إلزامي؟</th>
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold">الترتيب</th>
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold">الحالة</th>
                  <th className="p-4 text-gray-600 dark:text-gray-300 font-semibold text-left">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((def) => {
                  const branchName = def.branchId 
                    ? (branches.find(b => b.id === def.branchId)?.name || 'فرع مخصص')
                    : 'عام (كافة الفروع)';

                  return (
                    <tr key={def.id} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50/40 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="p-4 font-bold text-gray-800 dark:text-white">{def.label}</td>
                      <td className="p-4 text-gray-500 dark:text-gray-400 font-mono text-sm">{def.key}</td>
                      <td className="p-4 text-gray-600 dark:text-gray-300">
                        {FIELD_TYPES.find(t => t.id === def.fieldType)?.label || def.fieldType}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                        {def.branchId ? <Building size={14} className="text-primary" /> : <Shield size={14} className="text-gray-400 dark:text-gray-500" />}
                        {branchName}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-300">
                        {def.isRequired ? (
                          <span className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-md text-xs font-semibold">مطلوب</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 text-xs">اختياري</span>
                        )}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-300 font-semibold">{def.order}</td>
                      <td className="p-4">
                        {def.isActive ? (
                          <span className="text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit">
                            <Check size={12} /> نشط
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit">
                            <X size={12} /> معطل
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-left space-x-2 space-x-reverse">
                        <button
                          onClick={() => openEditModal(def)}
                          className="text-primary hover:bg-primary/10 dark:hover:bg-primary/20 p-2 rounded-xl transition-all"
                          title="تعديل الحقل"
                        >
                          <Edit3 size={18} />
                        </button>
                        <button
                          onClick={() => handleSoftDelete(def.id)}
                          className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 p-2 rounded-xl transition-all"
                          title="تعطيل/حذف"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Definition Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white/90 dark:bg-slate-800/95 backdrop-blur-xl rounded-3xl p-8 w-full max-w-lg shadow-2xl border border-white dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">إضافة تعريف حقل مخصص</h2>
            <form onSubmit={handleAddDefinition} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المفتاح التقني (Technical Key) *</label>
                <input
                  type="text"
                  required
                  pattern="^[a-zA-Z0-9_]+$"
                  value={formData.key}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                  className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none font-mono"
                  placeholder="e.g. expected_budget"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">يجب أن يحتوي فقط على أحرف إنجليزية وأرقام وعلامة _ دون مسافات</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الاسم المعروض بالعربية *</label>
                <input
                  type="text"
                  required
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="مثال: ميزانية العقد المتوقعة"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نوع البيانات *</label>
                  <select
                    value={formData.fieldType}
                    onChange={(e) => setFormData({ ...formData, fieldType: e.target.value })}
                    className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 outline-none"
                  >
                    {FIELD_TYPES.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تحديد الفرع</label>
                  <select
                    value={formData.branchId}
                    onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
                    className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 outline-none"
                  >
                    <option value="">كافة الفروع (عام)</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {formData.fieldType === 'SELECT' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">خيارات القائمة (مفصولة بفاصلة) *</label>
                  <input
                    type="text"
                    required
                    value={formData.optionsText}
                    onChange={(e) => setFormData({ ...formData, optionsText: e.target.value })}
                    className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="مثال: منخفض, متوسط, مرتفع"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الترتيب المعروض (Order)</label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: e.target.value })}
                    className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="0"
                  />
                </div>

                <div className="flex items-center gap-2 pt-5">
                  <input
                     type="checkbox"
                     id="isRequiredAdd"
                     checked={formData.isRequired}
                     onChange={(e) => setFormData({ ...formData, isRequired: e.target.checked })}
                     className="rounded text-primary focus:ring-primary border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 w-5 h-5"
                  />
                  <label htmlFor="isRequiredAdd" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                    حقل إلزامي (Required)
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white transition-colors"
                >
                  حفظ الحقل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Definition Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white/90 dark:bg-slate-800/95 backdrop-blur-xl rounded-3xl p-8 w-full max-w-lg shadow-2xl border border-white dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">تعديل تعريف حقل مخصص</h2>
            <form onSubmit={handleEditDefinition} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الاسم المعروض بالعربية *</label>
                <input
                  type="text"
                  required
                  value={editFormData.label}
                  onChange={(e) => setEditFormData({ ...editFormData, label: e.target.value })}
                  className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نوع البيانات *</label>
                <select
                  value={editFormData.fieldType}
                  onChange={(e) => setEditFormData({ ...editFormData, fieldType: e.target.value })}
                  className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 outline-none"
                >
                  {FIELD_TYPES.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              {editFormData.fieldType === 'SELECT' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">خيارات القائمة (مفصولة بفاصلة) *</label>
                  <input
                    type="text"
                    required
                    value={editFormData.optionsText}
                    onChange={(e) => setEditFormData({ ...editFormData, optionsText: e.target.value })}
                    className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الترتيب المعروض (Order)</label>
                  <input
                    type="number"
                    value={editFormData.order}
                    onChange={(e) => setEditFormData({ ...editFormData, order: e.target.value })}
                    className="w-full border-gray-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700 dark:text-white rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>

                <div className="flex flex-col gap-3 pt-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isRequiredEdit"
                      checked={editFormData.isRequired}
                      onChange={(e) => setEditFormData({ ...editFormData, isRequired: e.target.checked })}
                      className="rounded text-primary focus:ring-primary border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 w-5 h-5"
                    />
                    <label htmlFor="isRequiredEdit" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                      حقل إلزامي (Required)
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isActiveEdit"
                      checked={editFormData.isActive}
                      onChange={(e) => setEditFormData({ ...editFormData, isActive: e.target.checked })}
                      className="rounded text-primary focus:ring-primary border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 w-5 h-5"
                    />
                    <label htmlFor="isActiveEdit" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                      الحقل نشط (Active)
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-5 py-2.5 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white transition-colors"
                >
                  تحديث الحقل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
