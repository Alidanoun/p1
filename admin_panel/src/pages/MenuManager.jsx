import { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Plus, Edit2, Trash2, Image as ImageIcon, X, Check, Search, Upload, 
  DollarSign, ChevronDown, ChevronUp, Layers, List, Settings, 
  Info, AlertCircle, FolderPlus, XCircle
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { toast } from 'sonner';
import Header from '../components/Header';
import api, { getImageUrl } from '../api/client';
import { cn } from '../lib/utils';
import Switch from '../components/Switch';

const MenuManager = () => {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState(new Set());
  
  // Item Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ 
    title: '', 
    titleEn: '', // English
    description: '', 
    descriptionEn: '', // English
    basePrice: '', 
    categoryId: '', 
    isAvailable: true 
  });
  const [optionGroups, setOptionGroups] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [updatingId, setUpdatingId] = useState(null); // Track which item/option is updating

  // Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    nameEn: '', // English
    description: '',
    descriptionEn: '', // English
    isActive: true,
    sortOrder: 0
  });
  const [categoryImageFile, setCategoryImageFile] = useState(null);
  const [categoryPreviewUrl, setCategoryPreviewUrl] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [itemsRes, catRes] = await Promise.all([
        api.get('/items?admin=true'),
        api.get('/categories?admin=true')
      ]);
      setItems(itemsRes.data || []);
      setCategories(catRes.data || []);
    } catch {  
      toast.error('خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (itemId) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const onDrop = useCallback(acceptedFiles => {
    const file = acceptedFiles[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  }, []);

  const onCategoryDrop = useCallback(acceptedFiles => {
    const file = acceptedFiles[0];
    if (file) {
      setCategoryImageFile(file);
      setCategoryPreviewUrl(URL.createObjectURL(file));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: {'image/*': []},
    multiple: false
  });

  const { getRootProps: getCatRootProps, getInputProps: getCatInputProps, isDragActive: isCatDragActive } = useDropzone({
    onDrop: onCategoryDrop,
    accept: {'image/*': []},
    multiple: false
  });

  const handleOpenModal = (item = null) => {
    if (item) {
      setEditingId(item.id);
      setFormData({
        title: item.title,
        titleEn: item.titleEn || '',
        description: item.description,
        descriptionEn: item.descriptionEn || '',
        basePrice: item.basePrice.toString(),
        categoryId: item.categoryId.toString(),
        isAvailable: item.isAvailable !== false,
        isFeatured: item.isFeatured === true,
        excludeFromStats: item.excludeFromStats === true
      });
      setOptionGroups(item.optionGroups ? JSON.parse(JSON.stringify(item.optionGroups)) : []);
      setPreviewUrl(getImageUrl(item.image));
    } else {
      setEditingId(null);
      setFormData({ 
        title: '', 
        titleEn: '',
        description: '', 
        descriptionEn: '',
        basePrice: '', 
        categoryId: selectedCategory === 'all' ? (categories[0]?.id.toString() || '') : selectedCategory.toString(),
        isAvailable: true,
        isFeatured: false,
        excludeFromStats: false
      });
      setOptionGroups([]);
      setPreviewUrl('');
    }
    setImageFile(null);
    setIsModalOpen(true);
  };

  const handleOpenCategoryModal = (category = null) => {
    if (category) {
      setEditingCategoryId(category.id);
      setCategoryFormData({
        name: category.name,
        nameEn: category.nameEn || '',
        description: category.description || '',
        descriptionEn: category.descriptionEn || '',
        isActive: category.isActive !== false,
        sortOrder: category.sortOrder || 0
      });
      setCategoryPreviewUrl(getImageUrl(category.image));
    } else {
      setEditingCategoryId(null);
      setCategoryFormData({ name: '', nameEn: '', description: '', descriptionEn: '', isActive: true, sortOrder: categories.length });
      setCategoryPreviewUrl('');
    }
    setCategoryImageFile(null);
    setIsCategoryModalOpen(true);
  };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    const data = new FormData();
    data.append('name', categoryFormData.name);
    data.append('nameEn', categoryFormData.nameEn);
    data.append('description', categoryFormData.description);
    data.append('descriptionEn', categoryFormData.descriptionEn);
    data.append('isActive', categoryFormData.isActive);
    data.append('sortOrder', categoryFormData.sortOrder);
    
    if (categoryImageFile) {
        data.append('image', categoryImageFile);
    }

    try {
      const promise = editingCategoryId
        ? api.put(`/categories/${editingCategoryId}`, data, { headers: { 'Content-Type': 'multipart/form-data' }})
        : api.post('/categories', data, { headers: { 'Content-Type': 'multipart/form-data' }});
        
      toast.promise(promise, {
        loading: editingCategoryId ? 'جاري تحديث الفئة...' : 'جاري إضافة الفئة...',
        success: () => {
          fetchData();
          setIsCategoryModalOpen(false);
          return editingCategoryId ? 'تم تحديث الفئة بنجاح' : 'تم إضافة الفئة بنجاح';
        },
        error: (err) => err.response?.data?.error || 'فشل في معالجة الفئة'
      });
    } catch (error) {
      console.error('Category submit error:', error);
    }
  };

  const handleDeleteCategory = async (id, name) => {
    if (confirm(`هل أنت متأكد من حذف فئة "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      try {
        const promise = api.delete(`/categories/${id}`);
        toast.promise(promise, {
          loading: 'جاري حذف الفئة...',
          success: () => {
             fetchData();
             if (selectedCategory === id) setSelectedCategory('all');
             return 'تم حذف الفئة بنجاح';
          },
          error: (err) => err.response?.data?.error || 'فشل في حذف الفئة'
        });
      } catch (error) {
        console.error('Delete category error:', error);
      }
    }
  };

  const addGroup = () => {
    setOptionGroups([...optionGroups, {
      groupName: '',
      groupNameEn: '', // English
      type: 'SINGLE',
      isRequired: false,
      isActive: true,
      minSelect: 0,
      maxSelect: 1,
      options: []
    }]);
  };

  const updateGroup = (index, field, value) => {
    const newGroups = JSON.parse(JSON.stringify(optionGroups));
    newGroups[index][field] = value;
    if (field === 'type') {
      if (value === 'SINGLE') {
        newGroups[index].maxSelect = 1;
        if (newGroups[index].isRequired) newGroups[index].minSelect = 1;
      } else {
        newGroups[index].maxSelect = 5;
      }
    }
    if (field === 'isRequired' && newGroups[index].type === 'SINGLE') {
      newGroups[index].minSelect = value ? 1 : 0;
    }
    setOptionGroups(newGroups);
  };

  const removeGroup = (index) => {
    setOptionGroups(optionGroups.filter((_, i) => i !== index));
  };

  const addOption = (groupIndex) => {
    const newGroups = JSON.parse(JSON.stringify(optionGroups));
    newGroups[groupIndex].options.push({ name: '', nameEn: '', price: 0, isDefault: false, isAvailable: true });
    setOptionGroups(newGroups);
  };

  const updateOption = (groupIndex, optionIndex, field, value) => {
    const newGroups = JSON.parse(JSON.stringify(optionGroups));
    if (field === 'isDefault' && value === true && newGroups[groupIndex].type === 'SINGLE') {
      newGroups[groupIndex].options = newGroups[groupIndex].options.map((opt, i) => ({
        ...opt,
        isDefault: i === optionIndex
      }));
    } else {
      // Allow strings for price to enable typing decimals (e.g. "1.")
      newGroups[groupIndex].options[optionIndex][field] = value;
    }
    setOptionGroups(newGroups);
  };

  const removeOption = (groupIndex, optionIndex) => {
    const newGroups = JSON.parse(JSON.stringify(optionGroups));
    newGroups[groupIndex].options = newGroups[groupIndex].options.filter((_, i) => i !== optionIndex);
    setOptionGroups(newGroups);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = new FormData();
    data.append('title', formData.title);
    data.append('titleEn', formData.titleEn);
    data.append('description', formData.description || '');
    data.append('descriptionEn', formData.descriptionEn || '');
    data.append('basePrice', parseFloat(formData.basePrice) || 0);
    data.append('categoryId', formData.categoryId);
    data.append('isAvailable', formData.isAvailable);
    data.append('isFeatured', formData.isFeatured);
    data.append('excludeFromStats', formData.excludeFromStats);
    
    // Ensure all option prices are numbers before sending
    const sanitizedGroups = optionGroups.map(group => ({
      ...group,
      options: group.options.map(opt => ({
        ...opt,
        price: parseFloat(opt.price) || 0
      }))
    }));
    data.append('optionGroups', JSON.stringify(sanitizedGroups));
    if (imageFile) data.append('image', imageFile);

    try {
      const promise = editingId 
        ? api.put(`/items/${editingId}`, data, { headers: { 'Content-Type': 'multipart/form-data' }})
        : api.post('/items', data, { headers: { 'Content-Type': 'multipart/form-data' }});

      toast.promise(promise, {
        loading: 'جاري حفظ الصنف...',
        success: () => {
          fetchData();
          setIsModalOpen(false);
          return editingId ? 'تم تحديث الصنف بنجاح' : 'تم إضافة الصنف بنجاح';
        },
        error: 'فشل في حفظ الصنف'
      });
    } catch (error) {
      console.error('Item submit error:', error);
    }
  };

  const handleDelete = async (id) => {
    if (confirm('هل أنت متأكد من حذف هذا الصنف؟ لا يمكن التراجع عن هذا الإجراء.')) {
      try {
        await api.delete(`/items/${id}`);
        setItems(items.filter(i => i.id !== id));
        toast.success('تم حذف الصنف');
      } catch {  
        toast.error('فشل الحذف');
      }
    }
  };

  const toggleCategoryActive = async (category) => {
    const newState = !category.isActive;
    const catKey = `cat-toggle-${category.id}`;
    
    setUpdatingId(catKey);
    // Optimistic UI update
    setCategories(prevCats => prevCats.map(c => c.id === category.id ? { ...c, isActive: newState } : c));
    
    try {
      const response = await api.put(`/categories/${category.id}`, { isActive: newState });
      
      if (response.data) {
        setCategories(prevCats => prevCats.map(c => c.id === category.id ? response.data : c));
      }
      toast.success(newState ? `تم تفعيل قسم ${category.name}` : `تم إيقاف قسم ${category.name}`);
    } catch {  
      // Revert on failure
      setCategories(prevCats => prevCats.map(c => c.id === category.id ? { ...c, isActive: !newState } : c));
      toast.error('فشل تحديث حالة القسم');
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleItemAvailability = async (item) => {
    const newState = !item.isAvailable;
    const itemKey = `item-${item.id}`;
    
    setUpdatingId(itemKey);
    // Optimistic UI update
    setItems(prevItems => prevItems.map(i => String(i.id) === String(item.id) ? { ...i, isAvailable: newState } : i));
    
    try {
      // Use JSON instead of FormData for simple toggles - MUCH more reliable
      const response = await api.put(`/items/${item.id}`, { isAvailable: newState });
      
      // Update with final server data to ensure perfect sync
      if (response.data) {
        setItems(prevItems => prevItems.map(i => String(i.id) === String(item.id) ? response.data : i));
      }
    } catch (_e) {
      // Revert on failure
      setItems(prevItems => prevItems.map(i => String(i.id) === String(item.id) ? { ...i, isAvailable: !newState } : i));
      toast.error('فشل تحديث حالة التوفر');
      console.error('Toggle error:', _e);
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleOptionAvailability = async (item, groupIndex, optionIndex) => {
    const newGroups = JSON.parse(JSON.stringify(item.optionGroups));
    const currentOption = newGroups[groupIndex].options[optionIndex];
    const optionKey = `opt-${item.id}-${groupIndex}-${optionIndex}`;
    
    currentOption.isAvailable = !currentOption.isAvailable;

    setUpdatingId(optionKey);
    // Optimistic UI update
    setItems(prevItems => prevItems.map(i => 
      String(i.id) === String(item.id) ? { ...i, optionGroups: newGroups } : i
    ));

    try {
      // Use the new atomic PATCH endpoint for guaranteed reliability
      const response = await api.patch(`/items/${item.id}/options/toggle`, { 
        optionId: currentOption.id,
        isAvailable: currentOption.isAvailable 
      });

      if (response.data) {
        setItems(prevItems => prevItems.map(i => String(i.id) === String(item.id) ? response.data : i));
      }
    } catch {  
      toast.error('فشل تحديث الإضافة');
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredItems = items.filter(item => {
    const matchesCategory = selectedCategory === 'all' || item.categoryId === parseInt(selectedCategory);
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
        <Header 
          title="إدارة القائمة والمنيو" 
          subtitle="تحكم متقدم في الأصناف، الإضافات، وفئات الطعام" 
        />
        <div className="flex items-center gap-4">
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleOpenCategoryModal} 
            className="px-6 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center gap-3 font-bold hover:bg-emerald-500 hover:text-white transition-all shadow-lg shadow-emerald-500/10"
          >
            <FolderPlus className="w-5 h-5" />
            <span>إضافة فئة جديدة</span>
          </motion.button>
          
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleOpenModal()} 
            className="glass-button flex items-center justify-center gap-2 group h-14 px-8"
          >
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
            <span>إضافة صنف جديد</span>
          </motion.button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 mb-8 items-start lg:items-center justify-between">
        <div className="flex items-center gap-3 overflow-x-auto pb-2 w-full lg:w-auto scrollbar-hide">
          <button
            onClick={() => setSelectedCategory('all')}
            className={cn(
               "px-6 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap border",
               selectedCategory === 'all' 
                ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" 
                : "bg-card/40 text-text-muted border-white/5 hover:bg-white/5 hover:text-white"
            )}
          >
            جميع الأصناف ({items.length})
          </button>
          {categories.map((cat) => (
            <div key={cat.id} className="relative group/cat shrink-0 flex items-center">
              <button
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  "px-6 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap border pr-14 pl-12",
                  selectedCategory === cat.id 
                  ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" 
                  : "bg-card/40 text-text-muted border-white/5 hover:bg-white/5 hover:text-white"
                )}
              >
                {cat.name} ({items.filter(i => i.categoryId === cat.id).length})
              </button>
              
              {/* Quick Toggle Switch */}
              <div className="absolute right-3 top-1/2 -translate-y-1/2 scale-75">
                <Switch 
                  checked={cat.isActive} 
                  onChange={() => toggleCategoryActive(cat)}
                  disabled={updatingId === `cat-toggle-${cat.id}`}
                />
              </div>

              <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/cat:opacity-100 transition-opacity">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleOpenCategoryModal(cat); }}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
                  title="تعديل"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name); }}
                  className="p-1 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors"
                  title="حذف"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="relative w-full lg:w-80 group">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-primary transition-colors" />
          <input
            type="text"
            placeholder="ابحث عن صنف..."
            className="glass-input pr-12 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-20 opacity-30">جاري تحميل القائمة...</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20 opacity-30 italic">لا توجد أصناف تطابق بحثك.</div>
        ) : (
          <AnimatePresence mode='popLayout'>
            {filteredItems.map((item) => {
              const isExpanded = expandedItems.has(item.id);
              return (
                <motion.div
                  layout
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className={cn(
                    "glass-card overflow-hidden transition-all duration-300",
                    isExpanded ? "ring-2 ring-primary/20 bg-white/[0.04]" : "hover:bg-white/[0.02]"
                  )}
                >
                  <div className="p-4 md:p-6 flex flex-col md:flex-row items-center gap-6">
                    <div className="flex items-center gap-6 flex-1 w-full">
                      <div className="w-20 h-20 rounded-2xl overflow-hidden bg-slate-900/50 flex-shrink-0 cursor-pointer border border-white/5" onClick={() => toggleExpand(item.id)}>
                        {item.image ? <img src={getImageUrl(item.image)} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center opacity-20"><ImageIcon className="w-8 h-8" /></div>}
                      </div>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(item.id)}>
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-xl font-bold text-white truncate">{item.title}</h3>
                          <span className="px-2.5 py-0.5 rounded-lg bg-primary/10 text-primary text-[10px] uppercase font-black border border-primary/20">{categories.find(c => c.id === item.categoryId)?.name}</span>
                        </div>
                        <p className="text-sm text-text-muted line-clamp-1">{item.description || 'لا يوجد وصف.'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
                      <div className="text-xl font-black text-white font-mono">{Number(item.basePrice || 0).toFixed(2)} JOD</div>
                      <div className="flex items-center gap-4">
                        <Switch 
                          checked={item.isAvailable} 
                          onChange={() => toggleItemAvailability(item)} 
                          disabled={updatingId === `item-${item.id}`}
                        />
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleOpenModal(item)} className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:text-white hover:bg-white/10 transition-all"><Edit2 className="w-5 h-5" /></button>
                          <button onClick={() => handleDelete(item.id)} className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:text-danger hover:bg-danger/10 transition-all"><Trash2 className="w-5 h-5" /></button>
                          <button onClick={() => toggleExpand(item.id)} className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-text-muted hover:text-white transition-all">{isExpanded ? <ChevronUp className="w-6 h-6 text-primary" /> : <ChevronDown className="w-6 h-6" />}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-white/5 bg-black/20">
                        <div className="p-6 md:p-8 space-y-10">
                          {(!item.optionGroups || item.optionGroups.length === 0) ? <div className="text-center py-10 text-text-muted text-sm italic">لا توجد خيارات إضافية لهذا الصنف.</div> : item.optionGroups.map((group) => (
                            <div key={group.id} className="space-y-5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div className="px-3 py-1 rounded-xl bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-widest">{group.type === 'SINGLE' ? 'اختيار واحد' : 'اختيارات متعددة'}</div>
                                  <h4 className="text-lg font-bold text-white/80">{group.groupName}</h4>
                                  {group.isRequired && <span className="text-[10px] text-danger font-bold uppercase tracking-tighter">إجباري</span>}
                                </div>
                                {!group.isActive && <div className="px-2 py-1 rounded-lg bg-red-500/10 text-red-500 text-[8px] font-bold uppercase border border-red-500/20">غير نشط</div>}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {group.options?.map((opt, oIdx) => (
                                  <div 
                                    key={opt.id || oIdx} 
                                    className={cn(
                                      "p-4 rounded-2xl border transition-all flex items-center justify-between group/opt", 
                                      opt.isAvailable ? "bg-white/5 border-white/5 shadow-sm" : "bg-white/[0.02] border-white/5 opacity-40 grayscale-[0.5]"
                                    )}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className={cn("w-2 h-2 rounded-full shadow-lg", opt.isAvailable ? "bg-primary shadow-primary/20" : "bg-slate-600")} />
                                      <div>
                                        <div className="text-sm font-bold text-white flex items-center gap-2">
                                          {opt.name}
                                          {opt.isDefault && <span className="text-[8px] text-primary uppercase font-bold px-1 py-0.5 rounded-md bg-primary/10 border border-primary/20">افتراضي</span>}
                                        </div>
                                        <div className="text-xs text-text-muted font-mono">{Number(opt.price) > 0 ? `+${Number(opt.price).toFixed(2)} JOD` : 'مجاني'}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      {!opt.isAvailable && <span className="text-[9px] text-text-muted font-bold uppercase hidden md:inline">غير متوفر</span>}
                                      <Switch 
                                        checked={opt.isAvailable} 
                                        disabled={updatingId === `opt-${item.id}-${item.optionGroups.findIndex(g => g.groupName === group.groupName)}-${oIdx}`}
                                        onChange={() => {
                                          const gIdx = item.optionGroups.findIndex(g => g.id === group.id || g.groupName === group.groupName);
                                          toggleOptionAvailability(item, gIdx, oIdx);
                                        }} 
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Category Management Modal */}
      <AnimatePresence>
        {isCategoryModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsCategoryModalOpen(false)} className="absolute inset-0 bg-background/90 backdrop-blur-xl" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-2xl bg-[#0B0F19] rounded-[40px] border border-white/10 shadow-3xl overflow-hidden">
               <div className="p-8 md:p-10">
                  <div className="flex items-center justify-between mb-10">
                     <div>
                        <h2 className="text-3xl font-black text-white">{editingCategoryId ? 'تعديل الفئة' : 'إضافة فئة طعام جديدة'}</h2>
                        <p className="text-text-muted text-sm mt-1">{editingCategoryId ? 'قم بتعديل بيانات الفئة الحالية' : 'أنشئ تصنيفاً جديداً لتنظيم المنيو'}</p>
                     </div>
                     <button onClick={() => setIsCategoryModalOpen(false)} className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"><X className="w-6 h-6 text-white" /></button>
                  </div>
                  <form onSubmit={handleCategorySubmit} className="space-y-8">
                      {/* Category Image Dropzone */}
                      <div {...getCatRootProps()} className={cn("relative h-32 rounded-2xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-all overflow-hidden", isCatDragActive ? "border-primary bg-primary/5" : "border-white/10 hover:border-white/20")}>
                        <input {...getCatInputProps()} />
                        {categoryPreviewUrl 
                          ? <img src={categoryPreviewUrl} className="absolute inset-0 w-full h-full object-cover opacity-50" />
                          : <div className="text-center"><ImageIcon className="w-6 h-6 mx-auto text-white/20 mb-1" /><p className="text-[10px] font-bold text-text-muted">صورة القسم (اختياري)</p></div>
                        }
                      </div>
                     <div className="space-y-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-bold text-text-muted text-right px-2">الاسم (العربية)</label>
                          <input required type="text" placeholder="مثلاً: الوجبات الرئيسية" className="glass-input h-14 px-8 text-lg font-bold text-right" value={categoryFormData.name} onChange={e => setCategoryFormData({...categoryFormData, name: e.target.value})} />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-bold text-text-muted text-right px-2">Name (English)</label>
                          <input type="text" placeholder="e.g. Main Dishes" className="glass-input h-14 px-8 text-lg font-bold text-left" dir="ltr" value={categoryFormData.nameEn} onChange={e => setCategoryFormData({...categoryFormData, nameEn: e.target.value})} />
                        </div>
                     </div>
                     <div className="space-y-6">
                        <div className="flex items-center justify-between px-2">
                           <div className="flex items-center gap-4">
                              <span className="text-sm font-bold text-white">حالة الفئة:</span>
                              <Switch checked={categoryFormData.isActive} onChange={val => setCategoryFormData({...categoryFormData, isActive: val})} />
                              <span className={cn("text-[10px] font-black uppercase", categoryFormData.isActive ? "text-emerald-500" : "text-text-muted")}>{categoryFormData.isActive ? 'نشطة' : 'متوقفة'}</span>
                           </div>
                           <div className="flex items-center gap-3">
                              <span className="text-sm font-bold text-white">الترتيب:</span>
                              <input type="number" className="w-20 bg-white/5 border border-white/5 rounded-xl py-2 px-4 text-center font-mono font-bold text-white" value={categoryFormData.sortOrder} onChange={e => setCategoryFormData({...categoryFormData, sortOrder: parseInt(e.target.value)})} />
                           </div>
                        </div>
                     </div>
                     <button type="submit" className="w-full h-16 bg-primary text-white text-lg font-black rounded-3xl shadow-2xl flex items-center justify-center gap-3 hover:shadow-primary/20 transition-all">
                        <Check className="w-6 h-6" />
                        <span>{editingCategoryId ? 'حفظ التعديلات' : 'اعتماد الفئة الجديدة'}</span>
                     </button>
                  </form>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-background/90 backdrop-blur-xl" />
             <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-6xl max-h-[92vh] bg-[#0B0F19] rounded-[48px] border border-white/10 shadow-3xl overflow-hidden flex flex-col">
                <div className="p-8 md:p-12 flex-1 overflow-y-auto scrollbar-hide">
                   <div className="flex items-center justify-between mb-12">
                      <div>
                         <h2 className="text-4xl font-black text-white">{editingId ? 'تعديل الصنف' : 'إضافة صنف جديد'}</h2>
                         <p className="text-text-muted text-sm mt-2">أدخل تفاصيل الصنف الجديد وقم بضبط خيارات التخصيص والأسعار</p>
                      </div>
                      <button onClick={() => setIsModalOpen(false)} className="w-14 h-14 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"><X className="w-7 h-7 text-white" /></button>
                   </div>
                   <form onSubmit={handleSubmit} className="space-y-16">
                      <div className="grid grid-cols-1 xl:grid-cols-5 gap-16">
                         <div className="xl:col-span-2 space-y-10">
                            <div className="space-y-4">
                               <p className="text-[10px] font-black uppercase text-primary tracking-widest px-1 text-right">صورة الصنف</p>
                               <div {...getRootProps()} className={cn("relative h-64 rounded-[40px] border-2 border-dashed flex items-center justify-center transition-all cursor-pointer overflow-hidden", isDragActive ? "border-primary bg-primary/5" : "border-white/10 hover:border-white/20")}>
                                  <input {...getInputProps()} />
                                  {previewUrl ? <img src={previewUrl} className="absolute inset-0 w-full h-full object-cover opacity-40" /> : <div className="text-center"><Upload className="w-10 h-10 mx-auto text-white/20 mb-3" /><p className="text-xs font-bold text-text-muted uppercase">ارفع صورة الصنف</p></div>}
                               </div>
                            </div>
                            <div className="space-y-6">
                               <div className="space-y-3">
                                 <input required type="text" placeholder="اسم الصنف (العربية)" className="glass-input h-14 px-8 text-lg font-bold text-right" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
                                 <input type="text" placeholder="Item Title (English)" className="glass-input h-14 px-8 text-lg font-bold text-left" dir="ltr" value={formData.titleEn} onChange={e => setFormData({...formData, titleEn: e.target.value})} />
                               </div>
                                <div className="space-y-1">
                                  <div className="grid grid-cols-2 gap-4">
                                     <select required className="glass-input h-14 px-6 appearance-none bg-[#0F172A] text-right" value={formData.categoryId} onChange={e => setFormData({...formData, categoryId: e.target.value})}><option value="" disabled>اختر الفئة</option>{categories.map(c => <option key={c.id} value={c.id.toString()}>{c.name}</option>)}</select>
                                     <div className="relative flex items-center"><input type="text" inputMode="decimal" required placeholder="0.00" className="glass-input h-14 px-6 font-mono font-bold" value={formData.basePrice} onChange={e => {
                                       const val = e.target.value;
                                       if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                                         setFormData({...formData, basePrice: val});
                                       }
                                     }} /></div>
                                  </div>
                                  <p className="text-[10px] text-text-muted text-right px-2">
                                     * إذا كانت الإضافات تحدد السعر الكامل (مثل: كيلو/نص كيلو)، اجعل السعر الأساسي 0.
                                  </p>
                                </div>
                               <div className="space-y-3">
                                 <textarea placeholder="وصف الصنف..." className="glass-input min-h-[100px] px-8 py-4 resize-none text-right" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                                 <textarea placeholder="Item Description (English)..." className="glass-input min-h-[100px] px-8 py-4 resize-none text-left" dir="ltr" value={formData.descriptionEn} onChange={e => setFormData({...formData, descriptionEn: e.target.value})} />
                               </div>
                            </div>
                         </div>
                         <div className="xl:col-span-3 space-y-10">
                            <div className="flex items-center justify-between border-b border-white/5 pb-6">
                               <h3 className="text-xl font-black text-white uppercase tracking-tighter">مجموعات الخيارات والإضافات</h3>
                               <button type="button" onClick={addGroup} className="flex items-center gap-2 text-[10px] font-black text-primary uppercase bg-primary/10 px-6 py-3 rounded-2xl border border-primary/20 transition-all"><Plus className="w-4 h-4" /> إضافة مجموعة</button>
                            </div>
                            <div className="space-y-8 max-h-[650px] overflow-y-auto pr-4 scrollbar-hide">
                               {optionGroups.length === 0 ? <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-white/5 rounded-[40px] opacity-20 text-center"><Layers className="w-16 h-16 mb-6" /><p className="text-lg font-bold">لا توجد مجموعات خيارات.<br/><span className="text-sm font-normal">أضف خيارات زي الحجم أو الإضافات.</span></p></div> : optionGroups.map((group, gIdx) => (
                                 <div key={gIdx} className="glass-card !bg-white/[0.03] border-white/10 p-8 rounded-[40px] space-y-8">
                                    <div className="flex flex-col md:flex-row gap-6 justify-between border-b border-white/5 pb-8">
                               <div className="flex-1 space-y-4">
                                          <div className="flex flex-col gap-3">
                                            <input dir="rtl" placeholder="اسم المجموعة (مثلاً: الحجم)" className="bg-transparent border-b-2 border-white/5 text-xl font-black text-white focus:border-primary outline-none py-2 w-full transition-all text-right" value={group.groupName} onChange={e => updateGroup(gIdx, 'groupName', e.target.value)} />
                                            <input dir="ltr" placeholder="Group Name (e.g. Size)" className="bg-transparent border-b-2 border-white/5 text-lg font-bold text-white/60 focus:border-primary outline-none py-1 w-full transition-all text-left" value={group.groupNameEn} onChange={e => updateGroup(gIdx, 'groupNameEn', e.target.value)} />
                                          </div>
                                          <div className="flex items-center gap-6 justify-end">
                                             <Switch checked={group.isActive} onChange={() => updateGroup(gIdx, 'isActive', !group.isActive)} />
                                             <button type="button" onClick={() => updateGroup(gIdx, 'isRequired', !group.isRequired)} className={cn("px-4 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all", group.isRequired ? "bg-danger text-white" : "bg-white/5 text-text-muted border border-white/5")}>{group.isRequired ? 'إجباري' : 'اختياري'}</button>
                                             <button type="button" onClick={() => updateGroup(gIdx, 'type', group.type === 'SINGLE' ? 'MULTIPLE' : 'SINGLE')} className={cn("px-4 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all", group.type === 'SINGLE' ? "bg-primary text-white" : "bg-white/5 text-text-muted border border-white/5")}>{group.type === 'SINGLE' ? 'اختيار واحد' : 'اختيارات متعددة'}</button>
                                          </div>
                                       </div>
                                       <div className="flex flex-row md:flex-col items-end gap-3 min-w-[100px]">
                                          <div className="flex flex-col items-end"><span className="text-[8px] font-black text-text-muted uppercase mb-1">الحد الأدنى</span><input type="number" className="bg-white/5 w-16 text-center py-2 rounded-xl text-xs font-bold text-white border border-white/5" value={group.minSelect} onChange={e => updateGroup(gIdx, 'minSelect', e.target.value)} /></div>
                                          <div className="flex flex-col items-end"><span className="text-[8px] font-black text-text-muted uppercase mb-1">الحد الأعلى</span><input type="number" className="bg-white/5 w-16 text-center py-2 rounded-xl text-xs font-bold text-white border border-white/5" value={group.maxSelect} onChange={e => updateGroup(gIdx, 'maxSelect', e.target.value)} /></div>
                                          <button type="button" onClick={() => removeGroup(gIdx)} className="p-3 rounded-2xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"><Trash2 className="w-5 h-5" /></button>
                                       </div>
                                    </div>
                                    <div className="space-y-4">
                                       <div className="flex items-center justify-between mb-2">
                                          <button type="button" onClick={() => addOption(gIdx)} className="flex items-center gap-2 text-[10px] font-black text-primary uppercase bg-primary/10 px-5 py-2.5 rounded-xl hover:bg-primary/20 transition-all border border-primary/20"><Plus className="w-4 h-4" /> إضافة خيار</button>
                                          <span className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em]">{group.options?.length || 0} خيارات متاحة</span>
                                       </div>
                                       {group.options?.map((opt, oIdx) => (
                                         <div key={oIdx} className="flex flex-col md:flex-row items-center gap-4 bg-black/40 p-5 rounded-3xl border border-white/5 group/opt transition-all hover:bg-black/60">
                                            <div className="flex items-center gap-4 w-full md:w-auto">
                                               <button type="button" onClick={() => removeOption(gIdx, oIdx)} className="p-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-xl transition-all"><XCircle className="w-4 h-4" /></button>
                                               <button type="button" onClick={() => updateOption(gIdx, oIdx, 'isDefault', !opt.isDefault)} className={cn("px-3 py-2 rounded-xl text-[8px] font-bold uppercase transition-all", opt.isDefault ? "bg-primary/20 text-primary border border-primary/20" : "bg-white/5 text-text-muted border border-white/5 opacity-40 hover:opacity-100")}>افتراضي</button>
                                               <div className="relative flex items-center"><input type="text" inputMode="decimal" placeholder="0.0" className="bg-white/5 w-24 text-right px-4 py-2 rounded-xl text-xs font-mono font-bold text-white border border-white/5" value={opt.price} onChange={e => {
                                                 const val = e.target.value;
                                                 if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                                                   updateOption(gIdx, oIdx, 'price', val);
                                                 }
                                               }} /></div>
                                            </div>
                                             <div className="flex flex-col flex-1 gap-1">
                                               <input dir="rtl" placeholder="اسم الخيار" className="bg-transparent border-b border-white/5 w-full py-1 text-sm font-bold text-white outline-none focus:border-primary transition-all text-right" value={opt.name} onChange={e => updateOption(gIdx, oIdx, 'name', e.target.value)} />
                                               <input dir="ltr" placeholder="Option Name (English)" className="bg-transparent border-b border-white/5 w-full py-1 text-xs font-bold text-white/50 outline-none focus:border-primary transition-all text-left" value={opt.nameEn || ''} onChange={e => updateOption(gIdx, oIdx, 'nameEn', e.target.value)} />
                                             </div>
                                         </div>
                                       ))}
                                       

                                    </div>
                                 </div>
                               ))}
                            </div>
                         </div>
                      </div>
                      <div className="pt-10 flex flex-wrap items-center justify-between border-t border-white/10 gap-y-6">
                         <div className="flex flex-wrap items-center gap-8">
                            <div className="flex items-center gap-4">
                               <span className="text-sm font-bold text-white uppercase tracking-tighter">حالة التوفر</span>
                               <Switch checked={formData.isAvailable} onChange={val => setFormData({...formData, isAvailable: val})} />
                            </div>
                            <div className="flex items-center gap-4">
                               <span className="text-sm font-bold text-white uppercase tracking-tighter">الأكثر طلباً (سلايدر)</span>
                               <Switch checked={formData.isFeatured} onChange={val => setFormData({...formData, isFeatured: val})} />
                            </div>
                            <div className="flex items-center gap-4">
                               <span className="text-sm font-bold text-white uppercase tracking-tighter">استبعاد من الإحصائيات (مخفي)</span>
                               <Switch checked={formData.excludeFromStats} onChange={val => setFormData({...formData, excludeFromStats: val})} />
                            </div>
                         </div>
                         <motion.button type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="px-12 h-16 bg-primary text-white text-lg font-black rounded-3xl shadow-3xl text-center">حفظ التغييرات</motion.button>
                      </div>
                   </form>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MenuManager;