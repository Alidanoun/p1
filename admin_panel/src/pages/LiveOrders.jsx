import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Clock, CheckCircle, Package, Play, XCircle, Phone, DollarSign, Timer, AlertCircle, Printer, MapPin, Star, Truck, ShoppingBag, Power, Minus, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import Header from '../components/Header';
import api, { unwrap } from '../api/client';
import { cn } from '../lib/utils';
import { AnimatePresence, motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatCurrencyArabic } from '../lib/formatters';
import { useQueryClient } from '@tanstack/react-query';
import { useOrders } from '../hooks/queries/useOrders';
import { useBranchStats } from '../hooks/queries/useBranchStats';
import { useBranchStatus } from '../hooks/queries/useBranchStatus';
import { usePermissions } from '../hooks/usePermissions';
import InvoiceModal from '../components/InvoiceModal';
import BranchStats from '../components/BranchStats';
import { useUpdateOrderStatus } from '../hooks/mutations/useUpdateOrderStatus';

// Use a public notification sound or provide a placeholder
const NEW_ORDER_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';
const CANCEL_REQUEST_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2190/2190-preview.mp3';

// Safe UUID generation for HTTP/HTTPS contexts
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const COLUMNS = [
  { id: 'new', title: 'طلبات جديدة', color: 'bg-amber-500', icon: Clock, statuses: ['pending'] },
  { id: 'preparing', title: 'قيد التحضير', icon: Play, color: 'bg-indigo-500', statuses: ['preparing'] },
  { id: 'ready', title: 'جاهز للاستلام', icon: Package, color: 'bg-purple-500', statuses: ['ready'] },
  { id: 'completed', title: 'مكتمل', icon: CheckCircle, color: 'bg-emerald-500', statuses: ['delivered'] },
];

const COLUMN_TO_STATUS = {
  new: 'pending',
  preparing: 'preparing',
  ready: 'ready',
  completed: 'delivered'
};

const OrderCard = ({ order, index, forceOpen, onAdjustTimer, onUpdateStatus, onCancelOrder, onHandleRequest, can }) => {
  const [elapsed, setElapsed] = useState('');
  const [isDelayed, setIsDelayed] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);

  useEffect(() => {
    if (forceOpen) setShowInvoice(true);
  }, [forceOpen]);

  useEffect(() => {
    const updateTimer = () => {
      const created = new Date(order.createdAt || order.id);
      const now = new Date();
      const diffMs = Math.max(0, now - created);
      const diffMinutes = Math.floor(diffMs / 60000);
      const diffSeconds = Math.floor((diffMs % 60000) / 1000);
      
      let timeString = '';
      if (diffMinutes >= 60) {
        const diffHours = Math.floor(diffMinutes / 60);
        const remMins = diffMinutes % 60;
        timeString = `${diffHours.toString().padStart(2, '0')}:${remMins.toString().padStart(2, '0')}:${diffSeconds.toString().padStart(2, '0')}`;
      } else {
        timeString = `${diffMinutes.toString().padStart(2, '0')}:${diffSeconds.toString().padStart(2, '0')}`;
      }
      
      setElapsed(timeString);

      // ⏱️ Auto-accept logic (30 seconds)
      if (order.status === 'pending') {
        const secondsPassed = Math.floor(diffMs / 1000);
        if (secondsPassed >= 30) {
          onUpdateStatus(order.id, 'preparing', order.version, order.eventSequence);
        } else {
          setElapsed(`يقبل تلقائياً (${30 - secondsPassed}) ثانية`);
        }
      } else if (order.status === 'preparing' || order.status === 'confirmed') {
        // Show remaining prep time
        const prepTimeMs = (order.preparationTimeMinutes || 20) * 60000;
        const remainingMs = prepTimeMs - diffMs;
        if (remainingMs > 0) {
          const rMins = Math.floor(remainingMs / 60000);
          const rSecs = Math.floor((remainingMs % 60000) / 1000);
          setElapsed(`${rMins}:${rSecs.toString().padStart(2, '0')}`);
        } else {
          setElapsed('تأخير!');
        }
      }

      setIsDelayed(diffMinutes > (order.preparationTimeMinutes || 20) && order.status !== 'delivered');
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000); // Check every second for smooth countdowns
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
              isDelayed && order.status !== 'delivered' && "border-red-500/30 bg-red-500/5",
              order._optimistic && "opacity-60 pointer-events-none ring-1 ring-primary/30 animate-pulse"
            )}
          >
            <div className="flex justify-between items-start mb-3">
              <span className="text-[10px] font-mono text-text-muted">#{order.orderId?.substring(0, 8) || order.id.substring(0, 8)}</span>
              <div className="flex items-center gap-1 text-[10px] text-text-muted bg-white/5 px-2 py-0.5 rounded-full">
                <Timer className={cn("w-3 h-3", isDelayed && "text-red-500 animate-pulse")} />
                <span>{elapsed}</span>
              </div>
            </div>

            <h4 className="font-bold text-white mb-1">{order.customerName || order.customer?.name || '—'}</h4>
            <div className="flex items-center gap-2 text-xs text-text-muted mb-3">
              <Phone className="w-3 h-3" />
              <span>{order.customerPhone || order.customer?.phone || '—'}</span>
            </div>

            <div className="space-y-1 mb-4">
              {(order.cartItems || order.orderItems || []).slice(0, 2).map((item, i) => (
                <div key={i} className="text-xs flex justify-between text-text-muted transition-colors group-hover:text-white">
                  <span>{item.qty || item.quantity}x {item.title || item.itemName || 'صنف'}</span>
                </div>
              ))}
              {(order.cartItems || order.orderItems || []).length > 2 && (
                <p className="text-[10px] text-primary font-bold">+{(order.cartItems || order.orderItems).length - 2} أصناف أخرى</p>
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

            </div>

            <div className="flex flex-col gap-2 border-t border-white/5 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-primary font-black">
                  <DollarSign className="w-3 h-3" />
                  <span className="text-sm">{formatCurrencyArabic(order.total || order.totalPrice)}</span>
                </div>
                
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setShowInvoice(true)}
                    className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-text-muted transition-all"
                    title="الفاتورة"
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* ⚡ One-Tap Workflow Buttons */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {order.status === 'pending' && can('MANAGE_ORDERS') && (
                  <button
                    onClick={() => onUpdateStatus(order.id, 'preparing', order.version, order.eventSequence)}
                    className="col-span-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-white font-black text-xs shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    قبول الطلب
                  </button>
                )}
                
                {(order.status === 'preparing' || order.status === 'confirmed') && can('MANAGE_ORDERS') && (
                  <>
                    <button
                      onClick={() => onUpdateStatus(order.id, 'ready', order.version, order.eventSequence)}
                      className="col-span-2 py-2.5 bg-indigo-500 hover:bg-indigo-600 rounded-xl text-white font-black text-xs shadow-lg shadow-indigo-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Package className="w-4 h-4" />
                      الطلب جاهز
                    </button>
                    <div className="col-span-2 flex items-center justify-between bg-white/5 rounded-xl p-1 border border-white/5">
                      <button 
                        onClick={() => onAdjustTimer(order.id, -5)} 
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white font-bold text-[10px] transition-colors"
                      >
                        -5 دقيقة
                      </button>
                      <span className="text-[10px] font-bold text-text-muted">وقت التحضير: {order.preparationTimeMinutes || 20}د</span>
                      <button 
                        onClick={() => onAdjustTimer(order.id, 5)} 
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white font-bold text-[10px] transition-colors"
                      >
                        +5 دقيقة
                      </button>
                    </div>
                  </>
                )}

                {order.status === 'ready' && can('MANAGE_ORDERS') && (
                  <button
                    onClick={() => onUpdateStatus(order.id, 'delivered', order.version, order.eventSequence)}
                    className="col-span-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-white font-black text-xs shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <Truck className="w-4 h-4" />
                    تسليم الطلب
                  </button>
                )}
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
  const queryClient = useQueryClient();
  const { user, selectedBranchId } = useAuth();
  const { can } = usePermissions();
  
  // 🚀 [SSOT-CUTOVER] React Query Hooks
  const { data: orders = [], isLoading: ordersLoading } = useOrders(selectedBranchId);
  const { data: stats } = useBranchStats(selectedBranchId);
  const { data: restaurantStatus } = useBranchStatus(selectedBranchId);

  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);

  const [showHandleModal, setShowHandleModal] = useState(false);
  const [handleAction, setHandleAction] = useState('approve'); 
  const [rejectionReason, setRejectionReason] = useState('');
  const [isHandlingRequest, setIsHandlingRequest] = useState(false);
  const location = useLocation();
  const audioRef = useRef(null);
  const cancelAudioRef = useRef(null);

  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyDuration, setEmergencyDuration] = useState(30);
  const [emergencyType, setEmergencyType] = useState('timed'); 
  const [emergencyPassword, setEmergencyPassword] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // 🔄 All Manual useEffect Fetchers and Socket Listeners REMOVED.
  // Real-time synchronization is now handled by the SocketContext -> Query Invalidation pattern.

  const VALID_TRANSITIONS = {
    'pending': ['confirmed', 'preparing', 'cancelled'],
    'confirmed': ['preparing', 'ready', 'cancelled'],
    'preparing': ['ready', 'cancelled'],
    'ready': ['delivered', 'cancelled'],
    'delivered': [],
    'cancelled': []
  };

  const { mutate: updateStatus, isPending: isStatusUpdating } = useUpdateOrderStatus(selectedBranchId);

  const onUpdateStatus = (id, status, version) => {
    updateStatus(
      { orderId: id, newStatus: status, version },
      {
        onSuccess: () => toast.success('تم تحديث الحالة'),
        onError: (err) => {
          if (err.response?.status === 409) {
            toast.error('⚠️ تضارب: الطلب تغيّر من مستخدم آخر. تم المزامنة.');
          } else {
            toast.error('فشل في تحديث حالة الطلب');
          }
        },
      }
    );
  };

  const onAdjustTimer = async (id, delta) => {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    
    const currentPrep = order.preparationTimeMinutes || 20;
    const newPrep = Math.max(5, currentPrep + delta); 

    try {
      const idempotencyKey = generateUUID();
      await api.patch(`/orders/${id}/prep-time`, 
        { minutes: newPrep },
        { headers: { 'idempotency-key': idempotencyKey } }
      );
      queryClient.invalidateQueries({ queryKey: ['orders', selectedBranchId] });
      toast.success(`تم تحديث وقت التجهيز إلى ${newPrep} دقيقة`);
    } catch (err) {
      toast.error('فشل تحديث الوقت');
    }
  };

  const handleCancelClick = (order) => {
    setOrderToCancel(order);
    setCancelReason('');
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
      const idempotencyKey = generateUUID();
      await api.post(`/orders/${orderToCancel.id}/cancel`, 
        {
          reason: cancelReason,
          managerPassword: managerPassword,
          isAdmin: true
        },
        { headers: { 'idempotency-key': idempotencyKey } }
      );

      queryClient.invalidateQueries({ queryKey: ['orders', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['branchStats', selectedBranchId] });
      
      setShowCancelModal(false);
      toast.success('تم إلغاء الطلب بنجاح');
    } catch (err) {
      toast.error(err.response?.data?.error || 'فشل إلغاء الطلب');
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  useEffect(() => {
    // 🛡️ Component entry sync
  }, [selectedBranchId]);

  const onDragEnd = (result) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    
    if (!can('MANAGE_ORDERS')) {
      toast.error('غير مصرح لك بتغيير حالة الطلب');
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) return;

    const newStatus = COLUMN_TO_STATUS[destination.droppableId];
    if (!newStatus) return;

    const orderToUpdate = orders.find(o => o.id === draggableId);
    if (!orderToUpdate) return;

    const currentStatus = orderToUpdate.status;

    if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
      toast.error('انتقال غير مسموح لهذه الحالة');
      return;
    }

    updateStatus(
      {
        orderId: draggableId,
        newStatus,
        version: orderToUpdate.version,
      },
      {
        onSuccess: () => {
          toast.success(
            `تم نقل الطلب إلى: ${COLUMNS.find((c) => c.id === destination.droppableId)?.title}`
          );
        },
        onError: (err) => {
          if (err.response?.status === 409) {
            toast.error('⚠️ تضارب: الطلب تغيّر منذ آخر تحميل. تم التراجع والمزامنة.');
          } else {
            toast.error('فشل في تحديث حالة الطلب');
          }
        },
      }
    );
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
        action={
          can('TOGGLE_RESTAURANT_STATUS') && (
            <button
              onClick={() => setShowEmergencyModal(true)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full font-bold transition-all border shadow-sm",
                restaurantStatus?.isOpen
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                  : "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20"
              )}
            >
              <div className={cn(
                "w-2.5 h-2.5 rounded-full shadow-[0_0_8px]",
                restaurantStatus?.isOpen ? "bg-emerald-500 shadow-emerald-500/50" : "bg-red-500 shadow-red-500/50"
              )} />
              <span className="text-xs">
                {restaurantStatus?.isOpen ? 'مفتوح' : 'مغلق'}
              </span>
            </button>
          )
        }
      />

      {/* 📊 Light Operational Reporting */}
      <BranchStats />
      
      <audio ref={audioRef} src={NEW_ORDER_SOUND} preload="auto" />
      <audio ref={cancelAudioRef} src={CANCEL_REQUEST_SOUND} preload="auto" />

      {ordersLoading ? (
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

              // 👁️ [UI-FIX] Show all columns for structure, even if empty
              // if (ordersInColumn.length === 0) return null;

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
                              can={can}
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
                      const idempotencyKey = generateUUID();
                      const endpoint = handleAction === 'approve' ? 'approve-cancel' : 'reject-cancel';
                      
                      await api.post(`/orders/${orderToCancel.id}/${endpoint}`, 
                        { rejectionReason },
                        { headers: { 'idempotency-key': idempotencyKey } }
                      );
                      toast.success(handleAction === 'approve' ? 'تم قبول الإلغاء' : 'تم رفض الإلغاء');
                      
                      // 🛡️ [SSOT] Invalidate cache
                      queryClient.invalidateQueries({ queryKey: ['orders', selectedBranchId] });
                      
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

      {/* Emergency Close Modal */}
      {showEmergencyModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card w-full max-w-lg rounded-3xl border border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden"
          >
            <div className={cn(
              "p-6 flex items-center gap-4 border-b border-white/5",
              restaurantStatus?.isOpen ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
            )}>
              <div className={cn(
                "p-3 rounded-2xl",
                restaurantStatus?.isOpen ? "bg-red-500/20" : "bg-emerald-500/20"
              )}>
                <ShieldCheck className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-2xl font-black">{restaurantStatus?.isOpen ? 'تأكيد الإغلاق الطارئ' : 'فتح المطعم للطلبات'}</h3>
                <p className="text-sm opacity-70 font-medium">يتطلب هذا الإجراء صلاحيات المدير العام</p>
              </div>
            </div>

            <div className="p-8 space-y-8">
              <div className="space-y-4">
                {/* 1. Open Option */}
                <button
                  onClick={() => {
                    setEmergencyType('open');
                  }}
                  className={cn(
                    "w-full p-5 rounded-2xl border-2 transition-all flex items-center justify-between group",
                    (restaurantStatus?.isOpen && emergencyType !== 'timed' && emergencyType !== 'day') || emergencyType === 'open'
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                      : "border-white/5 bg-white/5 hover:border-white/10 text-text-muted"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn("w-3 h-3 rounded-full", (restaurantStatus?.isOpen && emergencyType !== 'timed' && emergencyType !== 'day') || emergencyType === 'open' ? "bg-emerald-500" : "bg-slate-600")} />
                    <div className="flex flex-col items-start">
                      <span className="font-black text-lg">مفتوح الان</span>
                      {(!restaurantStatus?.isOpen && restaurantStatus?.closesAt) && (
                        <span className="text-[10px] font-bold opacity-70">يفتح تلقائياً عند: {new Date(restaurantStatus.closesAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                      )}
                    </div>
                  </div>
                  <CheckCircle className={cn("w-6 h-6 transition-opacity", (restaurantStatus?.isOpen && emergencyType !== 'timed' && emergencyType !== 'day') || emergencyType === 'open' ? "opacity-100" : "opacity-0")} />
                </button>

                {/* 2. Timed Close Option */}
                <button
                  onClick={() => setEmergencyType('timed')}
                  className={cn(
                    "w-full p-5 rounded-2xl border-2 transition-all flex items-center justify-between group",
                    emergencyType === 'timed' ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-white/5 bg-white/5 hover:border-white/10 text-text-muted"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <Timer className={cn("w-6 h-6", emergencyType === 'timed' ? "text-amber-500" : "text-slate-600")} />
                    <span className="font-black text-lg">إغلاق لوقت محدد</span>
                  </div>
                  <CheckCircle className={cn("w-6 h-6 transition-opacity", emergencyType === 'timed' ? "opacity-100" : "opacity-0")} />
                </button>

                {/* 3. End of Day Close Option */}
                <button
                  onClick={() => setEmergencyType('day')}
                  className={cn(
                    "w-full p-5 rounded-2xl border-2 transition-all flex items-center justify-between group",
                    emergencyType === 'day' ? "border-red-500 bg-red-500/10 text-red-500" : "border-white/5 bg-white/5 hover:border-white/10 text-text-muted"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <Power className={cn("w-6 h-6", emergencyType === 'day' ? "text-red-500" : "text-slate-600")} />
                    <span className="font-black text-lg">إغلاق لنهاية اليوم</span>
                  </div>
                  <CheckCircle className={cn("w-6 h-6 transition-opacity", emergencyType === 'day' ? "opacity-100" : "opacity-0")} />
                </button>
              </div>

              {/* Conditional Controls */}
              {emergencyType === 'timed' && (
                <div className="bg-white/5 p-6 rounded-3xl border border-white/10 animate-in fade-in zoom-in-95">
                  <label className="block text-center text-[10px] font-black text-text-muted mb-4 uppercase tracking-[0.2em]">مدة الإغلاق (بالدقائق)</label>
                  <div className="flex items-center justify-center gap-10">
                    <button
                      onClick={() => setEmergencyDuration(prev => Math.max(5, prev - 5))}
                      className="w-14 h-14 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-all active:scale-90"
                    >
                      <Minus className="w-8 h-8" />
                    </button>
                    <div className="flex flex-col items-center min-w-[80px]">
                      <span className="text-6xl font-black text-white">{emergencyDuration}</span>
                      <span className="text-[10px] font-black text-amber-500 mt-2 uppercase tracking-widest">دقيقة</span>
                    </div>
                    <button
                      onClick={() => setEmergencyDuration(prev => prev + 5)}
                      className="w-14 h-14 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-all active:scale-90"
                    >
                      <Plus className="w-8 h-8" />
                    </button>
                  </div>
                </div>
              )}

              {emergencyType === 'day' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="bg-red-500/10 p-5 rounded-2xl border border-red-500/20 flex items-start gap-4">
                    <AlertCircle className="text-red-500 w-6 h-6 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm text-red-500 font-black">تحذير: إغلاق كلي</p>
                      <p className="text-xs text-red-500/70 font-medium leading-relaxed">
                        سيتم تعطيل الطلبات فوراً حتى منتصف الليل. يتطلب هذا الإجراء تأكيداً بكلمة مرور المدير العام.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-text-muted mb-2 uppercase tracking-widest ml-1">كلمة مرور المدير</label>
                    <input
                      type="password"
                      value={emergencyPassword}
                      onChange={(e) => setEmergencyPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white focus:border-red-500 focus:ring-4 focus:ring-red-500/10 outline-none transition-all placeholder:text-white/5"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-4 pt-4">
                <button
                  onClick={async () => {
                    const isClosingDay = emergencyType === 'day';
                    if (isClosingDay && !emergencyPassword) {
                      return toast.error('يرجى إدخال كلمة مرور المدير');
                    }
                    
                    const isOpening = emergencyType === 'open';
                    
                    setIsUpdatingStatus(true);
                    try {
                      await api.post('/restaurant/emergency-close', {
                        isOpen: isOpening,
                        type: emergencyType,
                        durationMinutes: emergencyDuration,
                        password: isClosingDay ? emergencyPassword : null,
                        reason: isOpening ? null : (emergencyType === 'day' ? 'مغلق لنهاية اليوم' : `مغلق مؤقتاً لمدة ${emergencyDuration} دقيقة`)
                      });
                      
                      toast.success(isOpening ? 'تم فتح استقبال الطلبات' : 'تم إغلاق المطعم بنجاح');
                      queryClient.invalidateQueries({ queryKey: ['orders', selectedBranchId] });
                      queryClient.invalidateQueries({ queryKey: ['branchStatus', selectedBranchId] });
                      setShowEmergencyModal(false);
                      setEmergencyPassword('');
                      setEmergencyType(null); // Reset
                    } catch (err) {
                      const msg = err.response?.data?.error?.message || err.response?.data?.error || 'حدث خطأ أثناء التحديث';
                      toast.error(msg);
                    } finally {
                      setIsUpdatingStatus(false);
                    }
                  }}
                  disabled={isUpdatingStatus}
                  className={cn(
                    "flex-[2] font-black py-4 rounded-2xl shadow-xl transition-all disabled:opacity-50 active:scale-95",
                    (emergencyType === 'open' || (restaurantStatus?.isOpen && !emergencyType)) ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20" : "bg-red-500 hover:bg-red-600 shadow-red-500/20"
                  )}
                >
                  {isUpdatingStatus ? 'جاري المعالجة...' : 'تأكيد الإجراء'}
                </button>
                <button
                  onClick={() => {
                    setShowEmergencyModal(false);
                    setEmergencyPassword('');
                    setEmergencyType(null);
                  }}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all"
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
