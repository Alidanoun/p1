import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, Trash2, User, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import DynamicFieldsRenderer from '../components/DynamicFieldsRenderer';

const STAGES = [
  { id: 'NEW', label: 'جديد', color: 'bg-green-100 text-green-700' },
  { id: 'CONTACTED', label: 'تم التواصل', color: 'bg-blue-100 text-blue-700' },
  { id: 'QUALIFIED', label: 'مؤهل', color: 'bg-purple-100 text-purple-700' },
  { id: 'PROPOSAL', label: 'تم تقديم عرض', color: 'bg-orange-100 text-orange-700' },
  { id: 'NEGOTIATION', label: 'مفاوضات', color: 'bg-yellow-100 text-yellow-700' },
  { id: 'WON', label: 'صفقة رابحة', color: 'bg-teal-100 text-teal-700' },
  { id: 'LOST', label: 'صفقة خاسرة', color: 'bg-red-100 text-red-700' }
];

export default function CRMPipeline() {
  const [opportunities, setOpportunities] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ title: '', value: '', expectedCloseDate: '', customFields: {} });
  const [customFieldsDefs, setCustomFieldsDefs] = useState([]);

  useEffect(() => {
    fetchPipeline();
    fetchCustomFieldsDefs();
  }, []);

  const fetchCustomFieldsDefs = async () => {
    try {
      const res = await api.get('/crm/custom-fields/definitions/OPPORTUNITY');
      setCustomFieldsDefs(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to fetch custom field definitions', err);
    }
  };

  const fetchPipeline = async () => {
    try {
      setLoading(true);
      const res = await api.get('/crm/opportunities');
      const data = res.data?.data?.opportunities || res.data?.opportunities || [];
      
      // Group by stage
      const grouped = STAGES.reduce((acc, stage) => {
        acc[stage.id] = data.filter(opp => opp.stage === stage.id);
        return acc;
      }, {});
      
      setOpportunities(grouped);
    } catch (err) {
      toast.error('فشل في جلب الصفقات');
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (result) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const sourceStage = source.droppableId;
    const destStage = destination.droppableId;
    
    // Optimistic UI update
    const sourceItems = [...opportunities[sourceStage]];
    const destItems = sourceStage === destStage ? sourceItems : [...opportunities[destStage]];
    
    const [movedItem] = sourceItems.splice(source.index, 1);
    movedItem.stage = destStage;
    
    destItems.splice(destination.index, 0, movedItem);

    setOpportunities(prev => ({
      ...prev,
      [sourceStage]: sourceItems,
      [destStage]: destItems
    }));

    // Perform API call
    try {
      let lossReason = null;
      if (destStage === 'LOST') {
        lossReason = window.prompt('ما هو سبب خسارة الصفقة؟');
        if (lossReason === null) {
          fetchPipeline(); // Revert
          return;
        }
      }
      
      // We pass the currentEntityVersion dynamically as well if we have it, 
      // but for simple UI we can just send the PATCH. The backend requires version header 
      // if optimistic locking is fully enforced, but it can fallback to reading it inside or taking it from body.
      await api.patch(`/crm/opportunities/${draggableId}/stage`, { 
        stage: destStage, 
        lossReason 
      });
      toast.success('تم تحديث مسار الصفقة');
      // fetchPipeline(); // Optionally refetch to ensure sync
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل في تحديث الصفقة');
      fetchPipeline(); // Revert on failure
    }
  };

  const handleAddOpportunity = async (e) => {
    e.preventDefault();
    try {
      // Include unique idempotency key
      await api.post('/crm/opportunities', formData, {
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      });
      toast.success('تم إضافة الصفقة بنجاح');
      setShowAddModal(false);
      setFormData({ title: '', value: '', expectedCloseDate: '', customFields: {} });
      fetchPipeline();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || 'فشل في الإضافة');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه الصفقة؟')) return;
    try {
      await api.delete(`/crm/opportunities/${id}`);
      toast.success('تم حذف الصفقة');
      fetchPipeline();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل الحذف');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/50 backdrop-blur-md p-6 rounded-3xl border border-white/20 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">مسار المبيعات (Pipeline)</h1>
          <p className="text-gray-500 mt-1">تتبع الصفقات وسحبها بين المراحل المختلفة</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-2xl flex items-center gap-2 transition-all shadow-lg shadow-primary/30"
        >
          <Plus /> إضافة صفقة
        </button>
      </div>

      {/* Kanban Board */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 min-h-[600px] items-start">
          {STAGES.map(stage => (
            <div key={stage.id} className="bg-gray-50/60 backdrop-blur-md rounded-2xl p-4 min-w-[300px] w-[300px] flex-shrink-0 border border-gray-100 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className={`px-3 py-1 rounded-full text-sm font-bold ${stage.color}`}>
                  {stage.label}
                </h3>
                <span className="text-gray-500 text-sm font-semibold">
                  {opportunities[stage.id]?.length || 0}
                </span>
              </div>
              
              <Droppable droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`min-h-[150px] transition-colors ${snapshot.isDraggingOver ? 'bg-gray-100/50 rounded-xl' : ''}`}
                  >
                    {opportunities[stage.id]?.map((opp, index) => (
                      <Draggable key={String(opp.id)} draggableId={String(opp.id)} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-3 group transition-all ${
                              snapshot.isDragging ? 'shadow-lg rotate-2 scale-105' : 'hover:shadow-md'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-bold text-gray-800 line-clamp-2">{opp.title}</h4>
                              <button onClick={() => handleDelete(opp.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <div className="flex items-center justify-between mt-4">
                              <div className="flex items-center gap-1 text-green-600 font-semibold text-sm">
                                <DollarSign size={16} />
                                {Number(opp.value || 0).toLocaleString()}
                              </div>
                              {opp.expectedCloseDate && (
                                <div className="text-xs text-gray-400">
                                  {new Date(opp.expectedCloseDate).toLocaleDateString('ar-IQ')}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {/* Add Opportunity Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl p-8 w-full max-w-md shadow-2xl border border-white">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">إضافة صفقة جديدة</h2>
            <form onSubmit={handleAddOpportunity} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">عنوان الصفقة *</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  placeholder="مشروع تجهيز قاعة"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">القيمة المتوقعة ($)</label>
                <input
                  type="number"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="5000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الإغلاق المتوقع</label>
                <input
                  type="date"
                  value={formData.expectedCloseDate}
                  onChange={(e) => setFormData({ ...formData, expectedCloseDate: e.target.value })}
                  className="w-full border-gray-200 bg-white/50 rounded-xl p-3 outline-none"
                />
              </div>

              {customFieldsDefs.length > 0 && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <h4 className="font-bold text-sm text-gray-700">بيانات إضافية مخصصة</h4>
                  <DynamicFieldsRenderer
                    definitions={customFieldsDefs}
                    values={formData.customFields}
                    onChange={(key, val) => setFormData(prev => ({
                      ...prev,
                      customFields: { ...prev.customFields, [key]: val }
                    }))}
                  />
                </div>
              )}
              
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
                  حفظ الصفقة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
