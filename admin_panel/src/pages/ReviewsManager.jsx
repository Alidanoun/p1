import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Trash2, Star, Search, Filter, Phone, Clock, FileText, Tag } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/Header';
import api from '../api/client';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import InvoiceModal from '../components/InvoiceModal';

const ReviewsManager = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, pending, approved
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    setLoading(true);
    try {
      const res = await api.get('/reviews');
      setReviews(res.data || []);
    } catch (err) {
      toast.error('فشل في تحميل التقييمات');
    } finally {
      setLoading(false);
    }
  };

  const toggleApproval = async (id, currentStatus) => {
    // Only item reviews have approval status in the new unified structure
    try {
      const newStatus = !currentStatus;
      await api.put(`/reviews/${id}/approve`, { isApproved: newStatus });
      setReviews(reviews.map(r => r.id === id ? { ...r, isApproved: newStatus } : r));
      toast.success(newStatus ? 'تمت الموافقة على التقييم' : 'تم إخفاء التقييم');
    } catch {
      toast.error('فشل في تعديل حالة التقييم');
    }
  };

  const deleteReview = async (id) => {
    if (confirm('هل أنت متأكد من حذف هذا التقييم نهائياً؟')) {
      try {
        if (typeof id === 'string' && id.startsWith('order-')) {
          // This is an order rating, we don't 'delete' the order, maybe just clear the rating?
          // For now, let's assume we just want to remove the rating from view.
          const realId = id.replace('order-', '');
          await api.patch(`/orders/${realId}/rate`, { rating: null, ratingComment: null });
        } else {
          await api.delete(`/reviews/${id}`);
        }
        setReviews(reviews.filter(r => r.id !== id));
        toast.success('تم حذف التقييم');
      } catch {
        toast.error('فشل في حذف التقييم');
      }
    }
  };

  const filteredReviews = reviews.filter(r => {
    const matchesFilter = filter === 'all' 
      ? true 
      : filter === 'pending' ? !r.isApproved : r.isApproved;
    
    const searchLow = searchQuery.toLowerCase();
    const matchesSearch = 
      (r.customerName || '').toLowerCase().includes(searchLow) ||
      (r.customerPhone || '').toLowerCase().includes(searchLow) ||
      (r.orderNumber || '').toLowerCase().includes(searchLow) ||
      (r.item?.title || '').toLowerCase().includes(searchLow) ||
      (r.comment || '').toLowerCase().includes(searchLow);

    return matchesFilter && matchesSearch;
  });

  const renderStars = (rating) => {
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(star => (
          <Star 
            key={star} 
            className={cn("w-4 h-4", star <= rating ? "fill-primary text-primary" : "text-white/20")}
          />
        ))}
        <span className="text-white font-bold ml-2 text-sm">{rating}/5</span>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20">
      <Header 
        title="إدارة التقييمات" 
        subtitle="راجع تقييمات العملاء ووافق عليها أو تصفح تقييمات الطلبات العامة" 
      />

      <div className="flex flex-col lg:flex-row gap-4 mb-8 mt-8 items-start lg:items-center justify-between">
        <div className="flex items-center gap-2 bg-card p-1 rounded-2xl border border-white/5">
          {['all', 'pending', 'approved'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                filter === f 
                  ? "bg-primary text-white shadow-lg shadow-primary/20" 
                  : "text-text-muted hover:text-white"
              )}
            >
              <Filter className="w-4 h-4" />
              {f === 'all' ? 'الكل' : f === 'pending' ? 'بانتظار الموافقة' : 'تمت الموافقة'}
              {f === 'pending' && reviews.filter(r => !r.isApproved).length > 0 && (
                <span className="bg-red-500 text-white min-w-[20px] h-[20px] flex items-center justify-center rounded-full text-[10px]">
                  {reviews.filter(r => !r.isApproved).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-96 group">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-primary transition-colors" />
          <input
            type="text"
            placeholder="ابحث بالاسم، الهاتف، رقم الطلب أو التعليق..."
            className="glass-input pr-12 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4">
        {loading ? (
          <div className="text-center py-20">
             <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
             <p className="opacity-30">جاري تحميل التقييمات...</p>
          </div>
        ) : filteredReviews.length === 0 ? (
          <div className="text-center py-20 opacity-30 italic">لا توجد تقييمات مطابقة.</div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredReviews.map((review) => (
              <motion.div
                key={review.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "glass-card p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 transition-all",
                  review.type === 'order_rating' ? "border-l-4 border-l-primary/50" : (!review.isApproved ? "border-l-4 border-l-red-500/50" : "border-l-4 border-l-emerald-500/50")
                )}
              >
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-white font-bold">{review.customerName || 'عميل مجهول'}</span>
                    {review.customerPhone && (
                      <div className="flex items-center gap-1 text-xs text-text-muted bg-white/5 px-2 py-0.5 rounded-full">
                        <Phone className="w-3 h-3" />
                        <span>{review.customerPhone}</span>
                      </div>
                    )}
                    <span className="text-text-muted text-sm flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {format(new Date(review.createdAt), 'yyyy-MM-dd HH:mm', { locale: ar })}
                    </span>
                    
                    {review.type === 'order_rating' ? (
                      <div className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-1 rounded-md border border-primary/20 font-bold uppercase">
                        <Tag className="w-3 h-3" />
                        تقييم طلب {review.orderNumber && `#${review.orderNumber.split('-').last || review.orderNumber}`}
                      </div>
                    ) : (
                      !review.isApproved && (
                        <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-1 rounded-md border border-red-500/20 font-bold uppercase">
                          قيد المراجعة
                        </span>
                      )
                    )}
                  </div>
                  
                  {renderStars(review.rating)}
                  
                  <div className="bg-white/5 rounded-xl p-4 text-sm text-text-muted italic border border-white/5">
                    "{review.comment || 'لا يوجد تعليق'}"
                  </div>
                  
                  {review.type === 'item_review' && (
                    <div className="flex items-center gap-2 text-xs font-bold text-white/50 bg-black/20 p-2 rounded-lg w-fit">
                      <span>طبق:</span>
                      <span className="text-white">{review.item?.title || 'طبق محذوف'}</span>
                    </div>
                  )}
                </div>

                  <div className="flex items-center gap-3 w-full md:w-auto">
                    {review.type === 'order_rating' && review.fullOrder && (
                      <button
                        onClick={() => setSelectedOrder(review.fullOrder)}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold bg-white/5 text-text-muted hover:text-white transition-all border border-white/5"
                      >
                        <FileText className="w-5 h-5" />
                        <span>استعراض الفاتورة</span>
                      </button>
                    )}

                    <button
                      onClick={() => toggleApproval(review.id, review.isApproved)}
                      className={cn(
                        "flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold transition-all",
                        review.isApproved 
                          ? "bg-white/5 text-text-muted hover:text-white" 
                          : "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                      )}
                    >
                      {review.isApproved ? <XCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                      <span>{review.isApproved ? 'إخفاء' : 'موافقة'}</span>
                    </button>

                  <button
                    onClick={() => deleteReview(review.id)}
                    className="p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all flex items-center justify-center"
                    title="حذف التقييم"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <InvoiceModal 
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
      />
    </div>
  );
};

export default ReviewsManager;
