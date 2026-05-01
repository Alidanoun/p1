import { useState, useEffect } from 'react';
import { ShoppingBag, AlertCircle, Zap, Star } from 'lucide-react';
import api, { unwrap } from '../api/client';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';

import { useAuth } from '../contexts/AuthContext';

const BranchStats = () => {
  const { user, selectedBranchId } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const url = selectedBranchId 
        ? `/api/analytics/branch/report/today?branchId=${selectedBranchId}` 
        : '/api/analytics/branch/report/today';
      const response = await api.get(url);
      setStats(unwrap(response));
    } catch (err) {
      console.error('Failed to fetch stats', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [selectedBranchId]);

  if (loading || !stats) return null;

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
      {user?.role?.toUpperCase() === 'ADMIN' && (
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
