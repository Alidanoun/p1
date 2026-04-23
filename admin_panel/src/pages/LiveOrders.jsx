import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Clock, CheckCircle, Package, Play, XCircle, Phone, DollarSign, Timer, AlertCircle, Printer, MapPin, Star, Truck, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import Header from '../components/Header';
import api from '../api/client';
import { cn } from '../lib/utils';
import { AnimatePresence, motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatCurrencyArabic } from '../lib/formatters';
import { useSocket } from '../contexts/SocketContext';
import InvoiceModal from '../components/InvoiceModal';

// Use a public notification sound or provide a placeholder
const NEW_ORDER_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const COLUMNS = [
  { id: 'new', title: 'طلبات جديدة', color: 'bg-amber-500', icon: Clock, statuses: ['pending'] },
  { id: 'in_progress', title: 'قيد التنفيذ', icon: Play, color: 'bg-indigo-500', statuses: ['confirmed', 'preparing'] },
  { id: 'issues', title: 'مشاكل', icon: AlertCircle, color: 'bg-red-600', statuses: ['waiting_cancellation'] },
  { id: 'ready', title: 'جاهز', icon: Package, color: 'bg-purple-500', statuses: ['ready'] },
  { id: 'completed', title: 'مكتمل', icon: CheckCircle, color: 'bg-emerald-500', statuses: ['in_route', 'delivered'] },
];

const COLUMN_TO_STATUS = {
  new: 'pending',
  in_progress: 'preparing',
  issues: 'waiting_cancellation',
  ready: 'ready',
  completed: 'delivered'
};

const OrderCard = ({ order, index, forceOpen, onAdjustTimer, onUpdateStatus, onCancelOrder, onHandleRequest }) => {
  const [elapsed, setElapsed] = useState('');
  const [isDelayed, setIsDelayed] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);

  useEffect(() => {
    if (forceOpen) setShowInvoice(true);
  }, [forceOpen]);

  useEffect(() => {
    const updateTimer = () => {
      const created = new Date(order.createdAt || order.id);
      setElapsed(formatDistanceToNow(created, { addSuffix: false, locale: ar }));
      
      const diffMinutes = (new Date() - created) / 60000;
      setIsDelayed(diffMinutes > 20 && order.status !== 'delivered');
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, [order]);

  return (
    <>
    <Draggable draggableId={order.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          id={`order-${order.id}`}
          className={cn(
            "bg-background/80 backdrop-blur-md p-4 rounded-xl border border-white/5 mb-3 shadow-md transition-all group",
            snapshot.isDragging ? "shadow-2xl ring-2 ring-primary border-primary/50" : "hover:border-white/10",
            isDelayed && order.status !== 'delivered' && "border-red-500/30 bg-red-500/5"
          )}
        >
          <div className="flex justify-between items-start mb-3">
            <span className="text-[10px] font-mono text-text-muted">#{order.orderId?.substring(0, 8) || order.id.substring(0, 8)}</span>
            <div className="flex items-center gap-1 text-[10px] text-text-muted bg-white/5 px-2 py-0.5 rounded-full">
              <Timer className={cn("w-3 h-3", isDelayed && "text-red-500 animate-pulse")} />
              <span>{elapsed}</span>
            </div>
          </div>

          <h4 className="font-bold text-white mb-1">{order.customerName}</h4>
          <div className="flex items-center gap-2 text-xs text-text-muted mb-3">
            <Phone className="w-3 h-3" />
            <span>{order.customerPhone}</span>
          </div>

          <div className="space-y-1 mb-4">
            {order.cartItems?.slice(0, 2).map((item, i) => (
              <div key={i} className="text-xs flex justify-between text-text-muted transition-colors group-hover:text-white">
                <span>{item.qty}x {item.title}</span>
              </div>
            ))}
            {order.cartItems?.length > 2 && (
              <p className="text-[10px] text-primary font-bold">+{order.cartItems.length - 2} أصناف أخرى</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
             <div className={cn(
               "px-2 py-0.5 rounded-md text-[9px] font-black uppercase flex items-center gap-1 border",
               order.orderType === 'delivery' ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
             )}>
                {order.orderType === 'delivery' ? <Truck className="w-3 h-3" /> : <ShoppingBag className="w-3 h-3" />}
                <span>{order.orderType === 'delivery' ? 'توصيل' : 'استلام'}</span>
             </div>
             
             {order.orderType === 'delivery' && (
               <div className="px-2 py-0.5 rounded-md bg-white/5 text-text-muted border border-white/5 text-[9px] font-bold flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  <span>{order.deliveryZoneName || 'منطقة غير محددة'}</span>
               </div>
             )}

             {/* 🏷️ Status Badges for Grouped Columns */}
             {order.status === 'confirmed' && (
               <div className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[9px] font-black flex items-center gap-1 animate-pulse">
                  <CheckCircle className="w-3 h-3" />
                  <span>مؤكد</span>
               </div>
             )}
             {order.status === 'in_route' && (
               <div className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-[9px] font-black flex items-center gap-1">
                  <Truck className="w-3 h-3" />
                  <span>في الطريق</span>
               </div>
             )}
             {order.status === 'waiting_cancellation' && (
               <div className="px-2 py-0.5 rounded-md bg-red-500/20 text-red-500 border border-red-500/30 text-[9px] font-black flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>طلب إلغاء</span>
               </div>
             )}
          </div>

          <div className="flex items-center justify-between border-t border-white/5 pt-3">
             <div className="flex flex-col">
                <div className="flex items-center gap-1 text-primary font-bold">
                    <DollarSign className="w-3 h-3" />
                    <span className="text-sm">{formatCurrencyArabic(order.total || order.totalPrice)}</span>
                </div>
                {order.estimatedReadyAt && order.status === 'preparing' && (
                  <div className="mt-2 text-[10px] text-blue-400 flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      <span>جاهز خلال: {new Date(order.estimatedReadyAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <div className="flex gap-1 mt-1">
                      <button 
                        onClick={() => onAdjustTimer(order.id, 5)}
                        className="px-1.5 py-0.5 bg-blue-500/20 hover:bg-blue-500/40 rounded text-blue-400 transition-colors"
                      >
                        +5د
                      </button>
                      <button 
                        onClick={() => onAdjustTimer(order.id, -5)}
                        className="px-1.5 py-0.5 bg-red-500/20 hover:bg-red-500/40 rounded text-red-400 transition-colors"
                      >
                        -5د
                      </button>
                    </div>
                  </div>
                )}
             </div>
             
             <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {order.status === 'preparing' && (
                  <button 
                    onClick={() => onUpdateStatus(order.id, 'ready')}
                    className="p-1.5 bg-green-500/20 hover:bg-green-500/40 rounded-md text-green-500 transition-all flex items-center gap-1"
                    title="الطلب جاهز"
                  >
                     <CheckCircle className="w-3.5 h-3.5" />
                     <span className="text-[10px] font-bold">جاهز</span>
                  </button>
                )}
                {order.status === 'ready' && (
                  <button 
                    onClick={() => onUpdateStatus(order.id, 'delivered')}
                    className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/40 rounded-md text-emerald-500 transition-all flex items-center gap-1"
                    title="تم التسليم"
                  >
                     <Package className="w-3.5 h-3.5" />
                     <span className="text-[10px] font-bold">تسليم</span>
                  </button>
                )}
                {(order.status === 'ready' || order.status === 'preparing' || order.status === 'pending') && (
                  <button 
                    onClick={() => onCancelOrder(order)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-md text-red-500 transition-all flex items-center gap-1"
                    title="إلغاء الطلب"
                  >
                     <XCircle className="w-3.5 h-3.5" />
                     <span className="text-[10px] font-bold">إلغاء</span>
                  </button>
                )}
                {order.status === 'waiting_cancellation' && (
                  <div className="flex gap-1">
                    <button 
                      onClick={() => onHandleRequest(order, 'approve')}
                      className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-md text-emerald-500 transition-all"
                      title="قبول الإلغاء"
                    >
                       <CheckCircle className="w-3.5 h-3.5" />
                       <span className="text-[10px] font-bold">قبول</span>
                    </button>
                    <button 
                      onClick={() => onHandleRequest(order, 'reject')}
                      className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-md text-red-500 transition-all"
                      title="رفض الإلغاء"
                    >
                       <XCircle className="w-3.5 h-3.5" />
                       <span className="text-[10px] font-bold">رفض</span>
                    </button>
                  </div>
                )}
                <button 
                  onClick={() => setShowInvoice(true)}
                  className="p-1.5 bg-white/5 hover:bg-white/10 rounded-md text-text-muted hover:text-white transition-all"
                  title="طباعة الفاتورة"
                >
                   <Printer className="w-3.5 h-3.5" />
                </button>
             </div>
          </div>
        </div>
      )}
    </Draggable>

    <InvoiceModal 
      order={order} 
      isOpen={showInvoice} 
      onClose={() => setShowInvoice(false)} 
    />
    </>
  );
};

const LiveOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);
  
  const [showHandleModal, setShowHandleModal] = useState(false);
  const [handleAction, setHandleAction] = useState('approve'); // 'approve' or 'reject'
  const [rejectionReason, setRejectionReason] = useState('');
  const [isHandlingRequest, setIsHandlingRequest] = useState(false);
  const location = useLocation();
  const audioRef = useRef(null);
  const prevOrdersCount = useRef(0);
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    // 🆕 Optimistic Reconciliation for New Orders
    const handleNewOrder = (newOrder) => {
      setOrders(prev => {
        // Prevent duplicates
        if (prev.some(o => o.id === newOrder.id)) return prev;
        return [newOrder, ...prev];
      });
      
      if (audioRef.current) audioRef.current.play();
      toast.success('طلب جديد وصل! 🔔', {
        description: `طلب جديد من ${newOrder.customerName}`,
        duration: 5000
      });

      // ⏱️ Reconciliation: Re-sync with API after 2 seconds to ensure final state consistency
      setTimeout(() => {
        fetchOrders(); // Silently sync in background
      }, 2000);
    };

    // 🔄 Standardized Status Updates
    const handleStatusUpdate = (updatedOrder) => {
      console.log('Received order update:', updatedOrder);
      setOrders(prev => {
        const index = prev.findIndex(o => o.id === updatedOrder.id || o.id === updatedOrder.orderId);
        if (index === -1) {
            // If it's not in our list (maybe it was archived but just updated?), fetch again
            fetchOrders();
            return prev;
        }

        // 🛡️ RACE SAFETY: Only update if the incoming data is NEWER than what we have
        const currentOrder = prev[index];
        const incomingTime = new Date(updatedOrder.updatedAt || new Date()).getTime();
        const currentTime = new Date(currentOrder.updatedAt || currentOrder.createdAt).getTime();

        if (incomingTime < currentTime) {
          console.warn('🕒 Stale socket update ignored for order', updatedOrder.id);
          return prev;
        }
        
        const newOrders = [...prev];
        newOrders[index] = { ...newOrders[index], ...updatedOrder };
        return newOrders;
      });
      
      // Visual feedback
      const element = document.getElementById(`order-${updatedOrder.id || updatedOrder.orderId}`);
      if (element) {
        element.classList.add('ring-2', 'ring-primary', 'scale-[1.02]');
        setTimeout(() => element.classList.remove('ring-2', 'ring-primary', 'scale-[1.02]'), 2000);
      }
    };

    socket.on('event:order:created', handleNewOrder);
    socket.on('event:order:updated', handleStatusUpdate);

    return () => {
      socket.off('event:order:created', handleNewOrder);
      socket.off('event:order:updated', handleStatusUpdate);
    };
  }, [socket]);

  useEffect(() => {
    if (location.state?.orderId && location.state?.autoDetails) {
      setSelectedOrderId(location.state.orderId);
      // Wait for data to load before scrolling
      if (!loading) {
        setTimeout(() => {
          const element = document.getElementById(`order-${location.state.orderId}`);
          if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 500);
      }
    }
  }, [location.state, loading]);

  const fetchOrders = async () => {
    try {
      const { data: response } = await api.get('/orders?active_only=true');
      
      // ✅ Handle both wrapped { success, data, pagination } and legacy [array] formats
      const ordersList = Array.isArray(response) ? response : (response.data || []);
      
      setOrders(ordersList);
      prevOrdersCount.current = ordersList.length;
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch orders', err);
      setLoading(false);
    }
  };

  const onAdjustTimer = async (id, minutes) => {
    try {
      const { data } = await api.patch(`/orders/${id}/timer`, { minutes });
      setOrders(prev => prev.map(o => o.id === id ? { ...o, estimatedReadyAt: data.estimatedReadyAt } : o));
      toast.success('تم تحديث الوقت');
    } catch {
      toast.error('فشل تحديث الوقت');
    }
  };

  const onUpdateStatus = async (id, status) => {
    try {
      const { data } = await api.patch(`/orders/${id}/status`, { status });
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: data.status } : o));
      toast.success('تم تحديث الحالة');
    } catch {
      toast.error('فشل تحديث الحالة');
    }
  };

  const handleCancelClick = (order) => {
    setOrderToCancel(order);
    setCancelReason(order.status === 'waiting_cancellation' ? (order.cancellation?.reason || '') : '');
    setManagerPassword('');
    setShowCancelModal(true);
  };

  const executeCancellation = async () => {
    if (!cancelReason) return toast.error('يجب ذكر سبب الإلغاء');
    if ((orderToCancel.status === 'ready' || orderToCancel.status === 'in_route') && !managerPassword) {
      return toast.error('مطلوب كلمة مرور المدير العام');
    }

    setIsSubmittingCancel(true);
    try {
      await api.post(`/orders/${orderToCancel.id}/cancel`, {
        reason: cancelReason,
        managerPassword: managerPassword,
        isAdmin: true
      });
      
      setOrders(prev => prev.filter(o => o.id !== orderToCancel.id));
      setShowCancelModal(false);
      toast.success('تم إلغاء الطلب بنجاح');
    } catch (err) {
      toast.error(err.response?.data?.error || 'فشل إلغاء الطلب');
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // 🛑 Polling Removed! replaced by Socket.io
  }, []);  

  const onDragEnd = async (result) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    // 🧠 Mapping column back to its primary target status
    const newStatus = COLUMN_TO_STATUS[destination.droppableId];
    if (!newStatus) return;

    const orderToUpdate = orders.find(o => o.id === draggableId);
    if (!orderToUpdate) return;

    // Optimistic update
    const updatedOrders = orders.map(o => o.id === draggableId ? { ...o, status: newStatus } : o);
    setOrders(updatedOrders);

    try {
      await api.patch(`/orders/${draggableId}/status`, { status: newStatus });
      toast.info(`تم تحديث حالة الطلب إلى: ${COLUMNS.find(c => c.id === destination.droppableId).title}`);
    } catch {
      toast.error('فشل في تحديث حالة الطلب');
      setOrders(orders); // Revert
    }
  };

  const getOrdersByColumn = (column) => {
    return orders.filter(o => column.statuses.includes(o.status));
  };

  return (
    <div className="p-4 md:p-8 h-full flex flex-col max-w-[1600px] mx-auto min-h-screen">
      <audio ref={audioRef} src={NEW_ORDER_SOUND} />
      
      <Header 
        title="الطلبات الحية" 
        subtitle="نظام السحب والإفلات لإدارة حالة الطلبات المباشرة" 
      />

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
               <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
               <p className="text-text-muted font-medium animate-pulse">جاري تحميل الطلبات...</p>
            </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex flex-row gap-4 h-full pb-8 overflow-x-auto min-h-[calc(100vh-200px)]">
            {COLUMNS.map((column) => {
              const ordersInColumn = getOrdersByColumn(column);
              
              // 👁️ Hide Empty Columns to focus on active tasks
              if (ordersInColumn.length === 0) return null;

              return (
                <div key={column.id} className="flex flex-col h-full min-w-[320px] max-w-[400px]">
                  {/* Column Header */}
                  <div className="mb-4 flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full", column.color)} />
                      <h3 className="font-bold text-white tracking-tight">{column.title}</h3>
                    </div>
                    <span className="bg-white/5 text-text-muted text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/5">
                      {ordersInColumn.length} طلبات
                    </span>
                  </div>

                  {/* Droppable Area */}
                  <Droppable droppableId={column.id}>
                    {(provided, snapshot) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className={cn(
                          "flex-1 bg-card/40 backdrop-blur-md rounded-2xl border border-white/5 p-3 overflow-y-auto transition-colors",
                          snapshot.isDraggingOver ? "bg-white/5 border-primary/20" : ""
                        )}
                      >
                        <AnimatePresence>
                          {ordersInColumn.map((order, index) => (
                            <OrderCard 
                              key={order.id} 
                              order={order} 
                              index={index} 
                              forceOpen={selectedOrderId === order.id || selectedOrderId === String(order.id) || selectedOrderId === parseInt(order.id)}
                              onAdjustTimer={onAdjustTimer}
                              onUpdateStatus={onUpdateStatus}
                              onCancelOrder={handleCancelClick}
                              onHandleRequest={(order, action) => {
                                 setOrderToCancel(order);
                                 setHandleAction(action);
                                 setRejectionReason('');
                                 if (action === 'approve') {
                                   setRejectionReason('CANCELLATION_APPROVED'); 
                                 }
                                 setShowHandleModal(true);
                               }}
                            />
                          ))}
                        </AnimatePresence>
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}

      {/* Rejection/Approval Modal for Requests */}
      {showHandleModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-w-md rounded-2xl border border-white/10 shadow-2xl p-6"
          >
            <div className={cn("flex items-center gap-3 mb-6", handleAction === 'approve' ? 'text-emerald-500' : 'text-red-500')}>
              {handleAction === 'approve' ? <CheckCircle className="w-8 h-8" /> : <XCircle className="w-8 h-8" />}
              <h3 className="text-xl font-bold">{handleAction === 'approve' ? 'موافقة على الإلغاء' : 'رفض الإلغاء وإكمال الطلب'}</h3>
            </div>

            <div className="space-y-4">
              {handleAction === 'reject' && (
                <div>
                  <label className="block text-xs font-bold text-text-muted mb-2 uppercase tracking-wider">سبب الرفض (سيظهر للعميل)</label>
                  <textarea 
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-primary outline-none transition-all h-24 resize-none"
                    placeholder="مثال: نعتذر منك، الطلب أصبح جاهزاً وتم تغليفه..."
                  />
                </div>
              )}

              {handleAction === 'approve' && (
                <div className="bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/20 mb-4">
                  <p className="text-sm text-emerald-500 font-medium">
                    سيتم إلغاء الطلب نهائياً، وفي حال كان السبب "تأخر المطعم"، سيتم تعويض العميل بنقاط الولاء المسجلة في الإعدادات.
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={async () => {
                    if (handleAction === 'reject' && !rejectionReason) return toast.error('يرجى ذكر سبب الرفض');
                    setIsHandlingRequest(true);
                    try {
                      await api.post(`/orders/${orderToCancel.id}/handle-cancellation`, {
                        action: handleAction,
                        rejectionReason
                      });
                      toast.success(handleAction === 'approve' ? 'تم قبول الإلغاء' : 'تم رفض الإلغاء');
                      setOrders(prev => prev.map(o => o.id === orderToCancel.id ? { ...o, status: handleAction === 'approve' ? 'cancelled' : o.cancellation.previousStatus } : o));
                      // Refresh orders to be safe
                      fetchOrders();
                      setShowHandleModal(false);
                    } catch (err) {
                      toast.error('حدث خطأ أثناء معالجة الطلب');
                    } finally {
                      setIsHandlingRequest(false);
                    }
                  }}
                  disabled={isHandlingRequest}
                  className={cn(
                    "flex-1 font-bold py-3 rounded-xl transition-all disabled:opacity-50",
                    handleAction === 'approve' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20' : 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                  )}
                >
                  {isHandlingRequest ? 'جاري المعالجة...' : 'تأكيد الإجراء'}
                </button>
                <button
                  onClick={() => setShowHandleModal(false)}
                  className="px-6 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-xl"
                >
                  تراجع
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Cancellation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-w-md rounded-2xl border border-white/10 shadow-2xl p-6"
          >
            <div className="flex items-center gap-3 mb-6 text-red-500">
              <XCircle className="w-8 h-8" />
              <h3 className="text-xl font-bold">تأكيد إلغاء الطلب</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-muted mb-2 uppercase tracking-wider">سبب الإلغاء</label>
                <textarea 
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-primary outline-none transition-all h-24 resize-none"
                  placeholder="اكتب سبب الإلغاء هنا..."
                />
              </div>

              {(orderToCancel?.status === 'ready' || orderToCancel?.status === 'in_route') && (
                <div>
                  <label className="block text-xs font-bold text-text-muted mb-2 uppercase tracking-wider">كلمة مرور المدير العام</label>
                  <input 
                    type="password"
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-primary outline-none transition-all"
                    placeholder="مطلوب لإلغاء طلبات جاهزة/في الطريق"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={executeCancellation}
                  disabled={isSubmittingCancel}
                  className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg shadow-red-500/20 transition-all flex items-center justify-center gap-2"
                >
                  {isSubmittingCancel ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
                </button>
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="px-6 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-xl transition-all"
                >
                  تراجع
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default LiveOrders;
