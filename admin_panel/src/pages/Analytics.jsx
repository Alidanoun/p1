import { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  Users, 
  ShoppingBag, 
  DollarSign, 
  Clock, 
  BarChart3, 
  PieChart as PieChartIcon,
  ChevronDown,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend
} from 'recharts';
import Header from '../components/Header';
import api, { unwrap } from '../api/client';
import { formatCurrencyArabic } from '../lib/formatters';
import { toast } from 'sonner';

const Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('week'); // today, week, month
  const [source, setSource] = useState('all'); // all, app, manual

  const fetchStats = async () => {
    setLoading(true);
    try {
      const stats = unwrap(await api.get(`/analytics/dashboard?period=${period}&source=${source}`));
      setData(stats);
    } catch (error) {
      console.error('Fetch stats error:', error);
      toast.error('فشل في تحميل الإحصائيات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [period, source]);

  const peakHourInfo = useMemo(() => {
    if (!data?.chartData || data.chartData.length === 0) return null;
    const sorted = [...data.chartData].sort((a, b) => b.count - a.count);
    return sorted[0];
  }, [data?.chartData]);

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // 🛡️ Error State: If data failed to load and we're no longer loading
  if (!data) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <PieChartIcon className="w-12 h-12 text-white/10 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">فشل تحميل البيانات</h2>
        <p className="text-text-muted mb-6">يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى</p>
        <button 
          onClick={fetchStats}
          className="bg-primary text-white px-8 py-3 rounded-xl font-bold hover:bg-primary-hover transition-all"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const COLORS = ['#FF7F3E', '#FFBB28', '#0088FE', '#00C49F', '#FF8042', '#8884d8'];

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <Header 
          title="مركز التحليلات المتقدمة" 
          subtitle="مراقبة أداء المطعم، ساعات الذروة، وأكثر الوجبات طلباً" 
        />
        
        <div className="flex items-center gap-3 bg-card/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/5 shadow-2xl">
          {['today', 'week', 'month'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${
                period === p 
                ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                : 'text-text-muted hover:text-white hover:bg-white/5'
              }`}
            >
              {p === 'today' ? 'اليوم' : p === 'week' ? 'الأسبوع' : 'الشهر'}
            </button>
          ))}
        </div>
      </div>

      {/* 🚀 Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard 
          title="إجمالي المبيعات" 
          value={formatCurrencyArabic(data.overview.totalRevenue)} 
          icon={<DollarSign className="text-emerald-500" />} 
          trend={null} 
          isPositive={true}
        />
        <StatCard 
          title="عدد الطلبات" 
          value={data.overview.totalOrders} 
          icon={<ShoppingBag className="text-primary" />} 
          trend={null} 
          isPositive={true}
        />
        <StatCard 
          title="متوسط قيمة الطلب" 
          value={formatCurrencyArabic(data.overview.avgOrderValue)} 
          icon={<TrendingUp className="text-blue-500" />} 
          trend={null} 
          isPositive={false}
        />
        <StatCard 
          title={period === 'today' ? "ساعة الذروة المتوقعة" : "اليوم الأكثر طلباً"} 
          value={data.overview.totalOrders > 0 ? (peakHourInfo?.label || "---") : "---"} 
          icon={<Clock className="text-amber-500" />} 
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* 📈 Revenue & Peak Activity */}
        <div className="xl:col-span-2 space-y-8">
          <ChartCard 
            title={period === 'today' ? "ضغط الطلبات بالساعة" : period === 'week' ? "ضغط الطلبات بالأيام" : "ضغط الطلبات بالشهر"} 
            icon={<Clock className="w-4 h-4" />}
          >
            <div className="h-[350px] w-full">
              {data.overview.totalOrders > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data?.chartData}>
                    <defs>
                      <linearGradient id="colorPeak" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF7F3E" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#FF7F3E" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis 
                      dataKey="label" 
                      stroke="#94a3b8" 
                      fontSize={10} 
                    />
                    <YAxis stroke="#94a3b8" fontSize={10} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      itemStyle={{ color: '#FF7F3E', fontWeight: 'bold' }}
                      labelFormatter={(val) => `الفترة: ${val}`}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="count" 
                      stroke="#FF7F3E" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorPeak)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-40">
                  <Clock className="w-12 h-12 mb-2" />
                  <p className="text-sm">لا توجد بيانات لهذا الوقت</p>
                </div>
              )}
            </div>
          </ChartCard>


        </div>

        {/* 🍔 Top Selling Items List */}
        <div className="space-y-8">
           <ChartCard 
             title="الوجبات الأكثر طلباً" 
             icon={<BarChart3 className="w-4 h-4" />}
             extra={
               <div className="flex bg-white/5 p-0.5 rounded-lg border border-white/5">
                 {[
                   { id: 'all', label: 'الكل' },
                   { id: 'app', label: 'تلقائي' },
                   { id: 'manual', label: 'يدوي' }
                 ].map(t => (
                   <button
                     key={t.id}
                     onClick={() => setSource(t.id)}
                     className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                       source === t.id ? 'bg-primary text-white' : 'text-text-muted'
                     }`}
                   >
                     {t.label}
                   </button>
                 ))}
               </div>
             }
           >
              <div className="h-[300px] w-full mb-8">
                {data.topItems.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.topItems} layout="vertical">
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={10} width={80} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      />
                      <Bar dataKey="quantity" radius={[0, 4, 4, 0]}>
                        {data?.topItems?.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-40">
                    <ShoppingBag className="w-12 h-12 mb-2" />
                    <p className="text-sm">لا توجد طلبات بعد</p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {data.topItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded bg-black/20 flex items-center justify-center text-[10px] font-bold text-primary">
                        {idx + 1}
                      </div>
                      <span className="text-xs font-bold text-white">{item.name}</span>
                    </div>
                    <span className="text-xs font-mono text-text-muted">{item.quantity} طلب</span>
                  </div>
                ))}
              </div>
           </ChartCard>


        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, trend, isPositive }) => (
  <div className="bg-card/40 backdrop-blur-md p-6 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden group hover:border-primary/20 transition-all">
    <div className="flex items-center justify-between mb-4">
      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
        {icon}
      </div>
      {trend && (
        <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${
          isPositive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
        }`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {trend}
        </div>
      )}
    </div>
    <p className="text-text-muted text-xs font-bold mb-1">{title}</p>
    <h3 className="text-2xl font-bold text-white tracking-tight">{value}</h3>
  </div>
);

const ChartCard = ({ title, icon, extra, children }) => (
  <div className="bg-card/40 backdrop-blur-md p-6 rounded-3xl border border-white/5 shadow-2xl">
    <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      {extra}
    </div>
    {children}
  </div>
);

export default Analytics;
