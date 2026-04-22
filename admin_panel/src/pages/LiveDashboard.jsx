import { useState, useMemo } from 'react';
import { 
  DollarSign, 
  TrendingUp, 
  ShoppingBag, 
  Activity, 
  Clock, 
  Users, 
  ChevronRight, 
  Target, 
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  History,
  LayoutDashboard,
  Timer,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  PieChart as PieChartIcon,
  Package,
  Inbox,
  Server,
  Wifi
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import Header from '../components/Header';
import { useSocket } from '../contexts/SocketContext';
import { formatCurrencyArabic, formatNumberArabic } from '../lib/formatters';
import { cn } from '../lib/utils';

// 🎭 Animation Variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { 
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

/**
 * ⚡ Live Counter Component
 * Only animates when the value actually changes (Animation Guard)
 */
const AnimatedCounter = ({ value, prefix = "", isCurrency = false }) => {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0.5, scale: 1.05, color: '#f97316' }}
      animate={{ opacity: 1, scale: 1, color: '#fff' }}
      transition={{ duration: 0.5 }}
      className="font-mono"
    >
      {prefix}{isCurrency ? formatCurrencyArabic(value) : formatNumberArabic(value)}
    </motion.span>
  );
};

/**
 * 🕳️ Empty State Component
 * Shows a professional placeholder when sections have no data
 */
const EmptyState = ({ icon: Icon, title, subtitle, compact = false }) => (
  <div className={cn(
    "flex flex-col items-center justify-center text-center",
    compact ? "py-8" : "py-16"
  )}>
    <div className={cn(
      "rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mb-4",
      compact ? "w-12 h-12" : "w-16 h-16"
    )}>
      <Icon className={cn("text-white/15", compact ? "w-6 h-6" : "w-8 h-8")} />
    </div>
    <p className={cn("font-bold text-white/30 mb-1", compact ? "text-xs" : "text-sm")}>{title}</p>
    {subtitle && <p className="text-[10px] text-white/15 max-w-[200px]">{subtitle}</p>}
  </div>
);

const LiveDashboard = () => {
  const { liveMetrics, metricsHistory, socket } = useSocket();
  const [topItemsTab, setTopItemsTab] = useState('quantity'); // 'quantity' | 'revenue'
  const [selectedOrder, setSelectedOrder] = useState(null);

  // 🛡️ RECOVERY STATUS INDICATOR
  const syncStatus = useMemo(() => {
    if (!socket?.connected) return { label: "استعادة الاتصال...", color: "amber", icon: RefreshCw };
    if (!liveMetrics) return { label: "مزامنة البيانات...", color: "blue", icon: Activity };
    return { label: "البث حي ومستقر", color: "emerald", icon: CheckCircle2 };
  }, [socket?.connected, liveMetrics]);

  // 🧠 TREND INTELLIGENCE (Weighted Model)
  const getTrendData = (keyPath) => {
    if (metricsHistory.length < 5 || !liveMetrics) return { direction: 'neutral', value: '0%' };
    
    const getValue = (m) => {
      const keys = keyPath.split('.');
      return keys.reduce((o, k) => o?.[k], m) || 0;
    };

    const rev = [...metricsHistory].reverse();
    const latest3 = rev.slice(0, 3).reduce((a, b) => a + getValue(b), 0) / Math.min(rev.length, 3);
    const older7 = rev.slice(3, 10).reduce((a, b) => a + getValue(b), 0) / Math.max(rev.length - 3, 1);
    
    const weightedAvg = (latest3 * 0.6) + (older7 * 0.4);
    const current = getValue(liveMetrics);

    if (weightedAvg === 0) return { direction: 'neutral', value: '0%' };

    const diffPercent = ((current - weightedAvg) / weightedAvg) * 100;

    if (diffPercent > 2) return { direction: 'up', value: `+${Math.abs(diffPercent).toFixed(1)}%` };
    if (diffPercent < -2) return { direction: 'down', value: `-${Math.abs(diffPercent).toFixed(1)}%` };
    return { direction: 'neutral', value: '0%' };
  };

  // 📊 Chart Data Normalization
  const statusChartData = useMemo(() => {
    // 🧱 Base set of statuses we ALWAYS want to show
    const coreStatuses = ['pending', 'preparing', 'ready', 'delivered', 'cancelled', 'waiting_cancellation'];
    
    const labels = {
      pending: 'قيد الانتظار',
      preparing: 'تجهيز',
      ready: 'جاهز',
      delivered: 'تم التسليم',
      cancelled: 'ملغي',
      waiting_cancellation: 'طلب إلغاء'
    };

    const colors = {
      pending: '#f59e0b',
      preparing: '#8b5cf6',
      ready: '#10b981',
      delivered: '#64748b',
      cancelled: '#ef4444',
      waiting_cancellation: '#f87171'
    };

    // Use liveMetrics or default to empty object
    const distribution = liveMetrics?.statusDistribution || {};

    return coreStatuses.map(status => ({
      name: labels[status] || status,
      value: distribution[status] || 0,
      color: colors[status] || '#ffffff'
    }));
  }, [liveMetrics]);

  const topItemsData = useMemo(() => {
    if (!liveMetrics?.topItems) return [];
    return [...liveMetrics.topItems]
      .sort((a, b) => b[topItemsTab] - a[topItemsTab])
      .slice(0, 5);
  }, [liveMetrics, topItemsTab]);

  if (!liveMetrics) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          className="mb-4"
        >
          <Zap className="w-12 h-12 text-primary opacity-20" />
        </motion.div>
        <p className="text-text-muted font-bold animate-pulse">جاري الاتصال بمركز العمليات اللحظي...</p>
      </div>
    );
  }

  const hasChartData = statusChartData.length > 0;
  const hasTopItems = topItemsData.length > 0;
  const hasActivity = liveMetrics.activityFeed && liveMetrics.activityFeed.length > 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto pb-20 overflow-hidden">
      
      <Header 
        title="مركز قيادة العمليات" 
        subtitle="تحليلات حية • مبيعات مباشرة • نبض النظام" 
      />

      {/* 🟢 Sync Status Bar */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className={cn(
          "inline-flex items-center gap-2.5 px-4 py-2 rounded-xl border transition-colors duration-500",
          syncStatus.color === 'emerald' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" :
          syncStatus.color === 'amber' ? "bg-amber-500/10 border-amber-500/20 text-amber-500" :
          "bg-blue-500/10 border-blue-500/20 text-blue-500"
        )}>
          <syncStatus.icon className={cn("w-3.5 h-3.5", syncStatus.color === 'amber' && "animate-spin")} />
          <span className="text-xs font-bold tracking-tight">{syncStatus.label}</span>
          {liveMetrics.sequence > 0 && (
            <span className="text-[10px] opacity-40 font-mono border-r border-current/20 pr-2.5 mr-1">
              v{liveMetrics.sequence}
            </span>
          )}
        </div>
      </motion.div>

      {/* 🚀 KPI Cards Row */}
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
      >
        <KPICard 
          title="الإيرادات الحية" 
          subtitle="Confirmed+"
          value={liveMetrics.revenue.live} 
          icon={Activity} 
          trend={getTrendData('revenue.live')} 
          color="blue" 
          isCurrency
        />
        <KPICard 
          title="الإيرادات المحققة" 
          subtitle="Delivered"
          value={liveMetrics.revenue.real} 
          icon={DollarSign} 
          trend={getTrendData('revenue.real')} 
          color="emerald" 
          isCurrency
        />
        <KPICard 
          title="إجمالي طلبات اليوم" 
          value={liveMetrics.revenue.orderCount} 
          icon={ShoppingBag} 
          trend={getTrendData('revenue.orderCount')} 
          color="purple" 
        />
        <KPICard 
          title="متوسط قيمة الطلب" 
          subtitle="AOV"
          value={liveMetrics.revenue.liveOrderCount > 0 ? (liveMetrics.revenue.live / liveMetrics.revenue.liveOrderCount) : 0} 
          icon={TrendingUp} 
          trend={getTrendData('revenue.live')}
          color="cyan" 
          isCurrency
        />
      </motion.div>

      {/* 📊 Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* ===== LEFT: Charts & Analytics (8 cols) ===== */}
        <div className="lg:col-span-8 space-y-4">
          
          {/* Status Distribution Chart */}
          <motion.div variants={itemVariants} initial="hidden" animate="visible" className="glass-panel p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-bold text-white flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Timer className="w-4 h-4 text-primary" />
                </div>
                توزيع حالات الطلبات
              </h3>
              <div className="text-[10px] font-bold text-emerald-500 flex items-center gap-2 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                مباشر <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            </div>
            
            {hasChartData ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusChartData}
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={4}
                        dataKey="value"
                        animationDuration={800}
                      >
                        {statusChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {statusChartData.map((s) => (
                    <div key={s.name} className="bg-background/50 p-3.5 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="text-[10px] font-bold text-text-muted truncate">{s.name}</span>
                      </div>
                      <p className="text-lg font-bold text-white">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState 
                icon={PieChartIcon} 
                title="لا توجد طلبات اليوم بعد" 
                subtitle="ستظهر هنا توزيعة حالات الطلبات فور ورودها"
              />
            )}
          </motion.div>

          {/* 🍔 Top Items */}
          <motion.div variants={itemVariants} initial="hidden" animate="visible" className="glass-panel p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <h3 className="text-base font-bold text-white flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Target className="w-4 h-4 text-primary" />
                </div>
                الأصناف الأكثر أداءً
              </h3>
              <div className="flex bg-background/60 p-1 rounded-lg border border-white/5">
                <button 
                  onClick={() => setTopItemsTab('quantity')}
                  className={cn(
                    "px-3.5 py-1.5 rounded-md text-[11px] font-bold transition-all",
                    topItemsTab === 'quantity' ? "bg-primary text-white shadow-md shadow-primary/20" : "text-text-muted hover:text-white"
                  )}
                >
                  حسب الكمية
                </button>
                <button 
                  onClick={() => setTopItemsTab('revenue')}
                  className={cn(
                    "px-3.5 py-1.5 rounded-md text-[11px] font-bold transition-all",
                    topItemsTab === 'revenue' ? "bg-primary text-white shadow-md shadow-primary/20" : "text-text-muted hover:text-white"
                  )}
                >
                  حسب الربح
                </button>
              </div>
            </div>

            {hasTopItems ? (
              <div className="space-y-3">
                <AnimatePresence mode='popLayout'>
                  {topItemsData.map((item, idx) => (
                    <motion.div 
                      layout
                      key={item.itemId}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="group flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-primary/20 transition-all"
                    >
                      <div className="w-10 h-10 rounded-lg bg-background border border-white/5 flex items-center justify-center font-bold text-primary text-sm shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 text-right min-w-0">
                        <h4 className="text-sm font-bold text-white group-hover:text-primary transition-colors truncate">{item.name}</h4>
                        <p className="text-[10px] text-text-muted font-medium">
                          {formatNumberArabic(item.quantity)} قطعة • {formatCurrencyArabic(item.revenue)}
                        </p>
                      </div>
                      <div className="w-24 lg:w-32 h-2 bg-white/5 rounded-full overflow-hidden shrink-0">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(item[topItemsTab] / topItemsData[0][topItemsTab]) * 100}%` }}
                          className={cn("h-full rounded-full", topItemsTab === 'quantity' ? "bg-primary" : "bg-emerald-500")}
                        />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <EmptyState 
                icon={Package} 
                title="لا توجد بيانات أصناف" 
                subtitle="ستظهر هنا أكثر الأصناف مبيعاً بعد ورود الطلبات"
              />
            )}
          </motion.div>
        </div>

        {/* ===== RIGHT: Activity Feed & System Health (4 cols) ===== */}
        <div className="lg:col-span-4 space-y-4">
          
          {/* Activity Feed */}
          <motion.div 
            variants={itemVariants} 
            initial="hidden" 
            animate="visible" 
            className="glass-panel flex flex-col overflow-hidden"
            style={{ maxHeight: hasActivity ? '520px' : 'auto' }}
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                  <History className="w-3.5 h-3.5 text-primary" />
                </div>
                النشاط الحي
              </h3>
              <Users className="w-3.5 h-3.5 text-text-muted" />
            </div>
            
            {hasActivity ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar-slim p-4 space-y-4">
                {liveMetrics.activityFeed.map((log, idx) => (
                  <motion.div 
                    key={log.id} 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    className="relative pr-5 border-r-2 border-white/5 pb-1 cursor-pointer hover:bg-white/[0.02] rounded-r-lg transition-colors group"
                    onClick={() => setSelectedOrder(log)}
                  >
                    <div className="absolute top-1 -right-[5px] w-2 h-2 rounded-full bg-primary ring-2 ring-primary/10 group-hover:scale-125 transition-transform" />
                    <div className="text-right">
                      <div className="flex items-center justify-between mb-1 opacity-70">
                        <span className="text-[9px] font-mono font-bold text-text-muted">
                          {new Date(log.time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="text-[10px] font-bold text-primary">#{log.orderNumber}</span>
                      </div>
                      <p className="text-xs font-bold text-white line-clamp-1">{log.action}</p>
                      {log.status && log.status !== 'unknown' && (
                        <div className="mt-1.5 text-[9px] font-bold inline-block px-2 py-0.5 rounded-md bg-white/5 text-text-muted">
                          الحالة: {log.status}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <EmptyState 
                icon={Inbox} 
                title="لا يوجد نشاط بعد" 
                subtitle="ستظهر هنا أحداث الطلبات الحية"
                compact
              />
            )}
          </motion.div>

          {/* System Health */}
          <motion.div 
            variants={itemVariants} 
            initial="hidden" 
            animate="visible"
            className="glass-panel p-5 bg-gradient-to-br from-primary/[0.03] to-transparent"
          >
            <div className="flex items-center gap-2.5 mb-4">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <Server className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <h4 className="text-xs font-bold text-white/60 uppercase tracking-wider">صحة النظام</h4>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-background/40 p-3 rounded-xl border border-white/5 text-center">
                <p className="text-[9px] font-bold text-text-muted mb-1">المزامنة</p>
                <p className="text-sm font-bold text-white">0.4s</p>
              </div>
              <div className="bg-background/40 p-3 rounded-xl border border-white/5 text-center">
                <p className="text-[9px] font-bold text-text-muted mb-1">الضغط</p>
                <p className="text-sm font-bold text-emerald-400">منخفض</p>
              </div>
              <div className="bg-background/40 p-3 rounded-xl border border-white/5 text-center">
                <p className="text-[9px] font-bold text-text-muted mb-1">الاتصال</p>
                <div className="flex items-center justify-center gap-1">
                  <Wifi className={cn("w-3.5 h-3.5", socket?.connected ? "text-emerald-400" : "text-red-400")} />
                  <p className={cn("text-sm font-bold", socket?.connected ? "text-emerald-400" : "text-red-400")}>
                    {socket?.connected ? 'متصل' : 'منقطع'}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

      </div>

      {/* 🎭 Order Details Timeline Modal */}
      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-background/90 backdrop-blur-xl"
              onClick={() => setSelectedOrder(null)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg glass-panel p-8"
            >
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-4">
                  <LayoutDashboard className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-1">طلب رقم {selectedOrder.orderNumber}</h2>
                <p className="text-text-muted text-sm">عرض التسلسل الزمني الكامل للعملية</p>
              </div>

              {/* Placeholder Timeline - Real one would fetchAudit(orderId) */}
              <div className="space-y-6 relative before:absolute before:right-6 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/5">
                {[
                  { label: 'تم استلام الطلب', status: 'pending', time: '14:20:05' },
                  { label: 'تأكيد الطلب يدويًا', status: 'confirmed', time: '14:21:12' },
                  { label: 'جارِ التجهيز في المطبخ', status: 'preparing', time: '14:22:45' }
                ].map((step, i) => (
                  <div key={i} className="relative pr-12 text-right">
                    <div className={cn(
                      "absolute top-1.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card",
                      i === 0 ? "bg-primary" : "bg-white/10"
                    )} />
                    <h4 className="text-sm font-bold text-white mb-1">{step.label}</h4>
                    <span className="text-[10px] font-mono font-bold text-text-muted">{step.time}</span>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => setSelectedOrder(null)}
                className="w-full mt-8 py-3.5 bg-primary hover:bg-primary-hover text-white font-bold rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
              >
                إغلاق التقرير
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

const KPICard = ({ title, subtitle, value, icon: Icon, trend, color, isCurrency }) => {
  const colorMap = {
    blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', glow: 'from-blue-500/5' },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', glow: 'from-emerald-500/5' },
    purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', text: 'text-purple-400', glow: 'from-purple-500/5' },
    cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400', glow: 'from-cyan-500/5' }
  };
  const c = colorMap[color];

  return (
    <motion.div 
      variants={itemVariants}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="glass-panel p-5 flex flex-col relative overflow-hidden group cursor-default"
    >
      {/* Subtle background glow */}
      <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent opacity-50", c.glow)} />
      
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className={cn("p-2.5 rounded-xl border", c.bg, c.border)}>
          <Icon className={cn("w-4.5 h-4.5", c.text)} />
        </div>
        
        {/* 🧠 Weighted Trend Indicator */}
        <div className={cn(
          "flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border",
          trend.direction === 'up' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
          trend.direction === 'down' ? "bg-red-500/10 border-red-500/20 text-red-400" :
          "bg-white/5 border-white/10 text-text-muted"
        )}>
          {trend.direction === 'up' ? <ArrowUpRight className="w-3 h-3" /> : 
           trend.direction === 'down' ? <ArrowDownLeft className="w-3 h-3" /> : 
           <Activity className="w-3 h-3 opacity-30" />}
          {trend.value}
        </div>
      </div>

      <div className="text-right relative z-10 mt-auto">
        <div className="flex items-center gap-1.5 justify-end mb-1">
          <h4 className="text-[10px] font-bold text-text-muted tracking-tight">{title}</h4>
          {subtitle && (
            <span className="text-[8px] font-bold text-white/20 uppercase">{subtitle}</span>
          )}
        </div>
        <p className="text-xl lg:text-2xl font-bold text-white">
          <AnimatedCounter value={value} isCurrency={isCurrency} />
        </p>
      </div>
    </motion.div>
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-white/10 p-3 rounded-xl shadow-2xl text-right">
        <p className="text-[10px] font-bold text-text-muted mb-0.5">{payload[0].name}</p>
        <p className="text-lg font-bold text-white">{payload[0].value}</p>
      </div>
    );
  }
  return null;
};

export default LiveDashboard;
