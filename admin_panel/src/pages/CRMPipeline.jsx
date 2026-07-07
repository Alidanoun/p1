import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, Trash2, DollarSign, Calendar, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

const STAGES = [
  { id: 'PROSPECTING', label: 'التنقيب (Prospecting)' },
  { id: 'QUALIFICATION', label: 'التأهيل (Qualification)' },
  { id: 'PROPOSAL', label: 'عرض السعر (Proposal)' },
  { id: 'NEGOTIATION', label: 'التفاوض (Negotiation)' },
  { id: 'CLOSED_WON', label: 'مغلقة - ربح (Won)' },
  { id: 'CLOSED_LOST', label: 'مغلقة - خسارة (Lost)' }
];

export default function CRMPipeline() {
  const [pipeline, setPipeline] = useState({
    PROSPECTING: [],
    QUALIFICATION: [],
    PROPOSAL: [],
    NEGOTIATION: [],
    CLOSED_WON: [],
    CLOSED_LOST: []
  });
  
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  
  const [formData, setFormData] = useState({
    title: '',
    value: '',
    expectedCloseDate: '',
    branchId: '',
    customFields: {}
  });

  useEffect(() => {
    fetchBranches();
    fetchPipeline();
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

  const fetchPipeline = async () => {
    try {
      setLoading(true);
      const res = await api.get('/crm/opportunities');
      const opps = res.data?.data?.opportunities || res.data?.opportunities || [];
      
      const newPipeline = {
        PROSPECTING: [], QUALIFICATION: [], PROPOSAL: [], 
        NEGOTIATION: [], CLOSED_WON: [], CLOSED_LOST: []
      };
      
      opps.forEach(opp => {
        if (newPipeline[opp.stage]) {
          newPipeline[opp.stage].push(opp);
        } else {
          newPipeline.PROSPECTING.push(opp); 
        }
      });
      
      setPipeline(newPipeline);
    } catch (err) {
      toast.error('فشل في جلب الصفقات');
    } finally {
      setLoading(false);
    }
  };

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const sourceColumn = pipeline[source.droppableId];
    const destColumn = pipeline[destination.droppableId];
    
    const sourceItems = [...sourceColumn];
    const destItems = [...destColumn];
    const [removed] = sourceItems.splice(source.index, 1);

    if (source.droppableId === destination.droppableId) {
      sourceItems.splice(destination.index, 0, removed);
      setPipeline({ ...pipeline, [source.droppableId]: sourceItems });
    } else {
      removed.stage = destination.droppableId;
      destItems.splice(destination.index, 0, removed);
      setPipeline({ ...pipeline, [source.droppableId]: sourceItems, [destination.droppableId]: destItems });
      
      try {
        await api.patch(`/crm/opportunities/${draggableId}/stage`, { 
          stage: destination.droppableId,
          version: removed.version
        });
        toast.success('تم نقل الصفقة بنجاح');
      } catch (err) {
        toast.error(err.response?.data?.message || 'فشل نقل الصفقة');
        fetchPipeline(); // rollback UI on error
      }
    }
  };

  const handleAddOpportunity = async (e) => {
    e.preventDefault();
    if (!formData.branchId) {
      toast.error('يرجى تحديد الفرع أولاً');
      return;
    }

    try {
      await api.post('/crm/opportunities', {
        ...formData,
        value: Number(formData.value) || 0,
        expectedCloseDate: formData.expectedCloseDate ? new Date(formData.expectedCloseDate).toISOString() : null
      }, {
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      });
      toast.success('تمت إضافة الصفقة بنجاح');
      setShowAddModal(false);
      setFormData({ title: '', value: '', expectedCloseDate: '', branchId: branches[0]?.id || '', customFields: {} });
      fetchPipeline();
    } catch (err) {
      toast.error(err.response?.data?.message || 'فشل في إضافة الصفقة');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه الصفقة؟')) return;
    try {
      await api.delete(`/crm/opportunities/${id}`);
      toast.success('تم حذف الصفقة');
      fetchPipeline();
    } catch (err) {
      toast.error('فشل في الحذف');
    }
  };

  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100 flex flex-col h-[calc(100vh-120px)]">
      
      {/* Header */}
      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-6 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">مسار المبيعات (Pipeline)</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">تتبع الصفقات وفرص المبيعات عبر مراحلها المختلفة (Kanban).</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 rounded-md transition-colors text-sm font-medium shadow-sm"
        >
          <Plus size={16} /> صفقة جديدة
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto pb-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 min-w-max h-full">
            {STAGES.map((stage) => (
              <div key={stage.id} className="w-80 flex flex-col bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-gray-200 dark:border-slate-700 h-full max-h-full">
                
                {/* Column Header */}
                <div className="p-3 border-b border-gray-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 rounded-t-lg shrink-0">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 tracking-wide">{stage.label}</h3>
                    <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold px-2 py-0.5 rounded-full">
                      {pipeline[stage.id]?.length || 0}
                    </span>
                  </div>
                  <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <DollarSign size={12} />
                    {pipeline[stage.id]?.reduce((sum, opp) => sum + (opp.value || 0), 0).toLocaleString()} د.ع
                  </div>
                </div>

                {/* Column Content */}
                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`flex-1 p-3 overflow-y-auto space-y-3 transition-colors ${snapshot.isDraggingOver ? 'bg-slate-100 dark:bg-slate-800/50' : ''}`}
                    >
                      {pipeline[stage.id]?.map((opp, index) => (
                        <Draggable key={opp.id.toString()} draggableId={opp.id.toString()} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`bg-white dark:bg-slate-800 rounded-md p-3 border border-gray-200 dark:border-slate-700 shadow-sm group ${snapshot.isDragging ? 'shadow-lg rotate-2 scale-105' : 'hover:border-slate-400 dark:hover:border-slate-500'} transition-all`}
                            >
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex items-start gap-2">
                                  <div {...provided.dragHandleProps} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-0.5 cursor-grab">
                                    <GripVertical size={14} />
                                  </div>
                                  <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-200 leading-tight">
                                    {opp.title}
                                  </h4>
                                </div>
                                <button
                                  onClick={() => handleDelete(opp.id)}
                                  className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                              
                              <div className="space-y-1.5 mt-3 pl-6">
                                <div className="flex items-center text-xs font-semibold text-slate-700 dark:text-slate-300">
                                  <DollarSign size={12} className="ml-1 text-slate-400 dark:text-slate-500" />
                                  {opp.value ? opp.value.toLocaleString() : '0'} د.ع
                                </div>
                                {opp.expectedCloseDate && (
                                  <div className="flex items-center text-xs text-slate-500 dark:text-slate-400">
                                    <Calendar size={12} className="ml-1 opacity-70" />
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
      </div>

      {/* Add Opportunity Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">إضافة صفقة جديدة</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                &times;
              </button>
            </div>
            
            <form id="oppForm" onSubmit={handleAddOpportunity} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">عنوان الصفقة *</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  placeholder="مثال: توريد 50 جهاز للشركة س"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">الفرع *</label>
                <select
                  required
                  value={formData.branchId}
                  onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                >
                  {branches.length === 0 && <option value="">جاري التحميل...</option>}
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">القيمة المتوقعة (د.ع)</label>
                <div className="relative">
                  <DollarSign size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="number"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    placeholder="0.00"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">تاريخ الإغلاق المتوقع</label>
                <div className="relative">
                  <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="date"
                    value={formData.expectedCloseDate}
                    onChange={(e) => setFormData({ ...formData, expectedCloseDate: e.target.value })}
                    className="w-full border border-gray-300 dark:border-slate-600 rounded-md p-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </form>
            
            <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 flex justify-end gap-3 rounded-b-lg">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="oppForm"
                className="px-4 py-2 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 rounded-md text-sm font-medium shadow-sm transition-colors"
              >
                إضافة الصفقة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
