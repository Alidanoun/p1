import { ShoppingBag, AlertCircle, Zap, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../contexts/AuthContext';
import { useBranchStats } from '../hooks/queries/useBranchStats';

const BranchStats = () => {
  const { selectedBranchId } = useAuth();
  const { can } = usePermissions();
  const { data: stats, isLoading } = useBranchStats(selectedBranchId);

  if (isLoading || !stats) return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[1,2,3,4].map(i => (
        <div key={i} className="h-20 bg-white/5 border border-white/10 rounded-2xl animate-pulse" />
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <StatCard 
        title="إجمالي طلبات اليوم" 
        value={stats.totalOrders} 
        icon={ShoppingBag} 
        color="blue" 
      />
      <StatCard 
        title="الطلبات النشطة" 
        value={stats.activeOrders} 
        icon={Zap} 
        color="emerald" 
      />
      {can('VIEW_GLOBAL_STATS') && (
        <StatCard 
          title="عمليات الإلغاء" 
          value={stats.cancellations} 
          icon={AlertCircle} 
          color="red" 
        />
      )}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-2">
          <Star className="w-4 h-4 text-amber-500" />
          <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">الأكثر مبيعاً</span>
        </div>
        <div className="space-y-1">
          {stats.topItems && stats.topItems.length > 0 ? stats.topItems.map((item, idx) => (
            <div key={idx} className="flex justify-between items-center text-[11px] font-bold">
              <span className="text-white truncate max-w-[100px]">{item.name}</span>
              <span className="text-amber-500">{item.count}x</span>
            </div>
          )) : (
            <span className="text-[10px] text-white/20 italic">لا توجد بيانات</span>
          )}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, color }) => {
  const colors = {
    blue: "text-blue-500 bg-blue-500/10 border-blue-500/20",
    emerald: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    red: "text-red-500 bg-red-500/10 border-red-500/20"
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-4"
    >
      <div className={cn("p-2.5 rounded-xl border", colors[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h4 className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">{title}</h4>
        <p className="text-xl font-black text-white">{value}</p>
      </div>
    </motion.div>
  );
};

export default BranchStats;
