import { useState, useEffect } from 'react';
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

  const fetchStats = async () => {
    setLoading(true);
    try {
      const stats = unwrap(await api.get(`/analytics/dashboard?period=${period}`));
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
  }, [period]);

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-8 h-8 text-primary animate-spin" />
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
          value={formatCurrencyArabic(data?.overview?.totalRevenue)} 
          icon={<DollarSign className="text-emerald-500" />} 
          trend="+12%" 
          isPositive={true}
        />
        <StatCard 
          title="عدد الطلبات" 
          value={data?.overview?.totalOrders} 
          icon={<ShoppingBag className="text-primary" />} 
          trend="+5%" 
          isPositive={true}
        />
        <StatCard 
          title="متوسط قيمة الطلب" 
          value={formatCurrencyArabic(data?.overview?.avgOrderValue)} 
          icon={<TrendingUp className="text-blue-500" />} 
          trend="-2%" 
          isPositive={false}
        />
        <StatCard 
          title="ساعة الذروة المتوقعة" 
          value={`${data?.peakHours?.sort((a,b) => b.count - a.count)[0]?.hour || 0}:00`} 
          icon={<Clock className="text-amber-500" />} 
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* 📈 Revenue & Peak Activity */}
        <div className="xl:col-span-2 space-y-8">
          <ChartCard title="ساعات الذروة (ضغط الطلبات)" icon={<Clock className="w-4 h-4" />}>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.peakHours}>
                  <defs>
                    <linearGradient id="colorPeak" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF7F3E" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#FF7F3E" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis 
                    dataKey="hour" 
                    stroke="#94a3b8" 
                    fontSize={10} 
                    tickFormatter={(val) => `${val}:00`}
                  />
                  <YAxis stroke="#94a3b8" fontSize={10} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    itemStyle={{ color: '#FF7F3E', fontWeight: 'bold' }}
                    labelFormatter={(val) => `الساعة: ${val}:00`}
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
            </div>
          </ChartCard>

          <ChartCard title="تريند المبيعات (آخر 7 أيام)" icon={<TrendingUp className="w-4 h-4" />}>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.revenueTrend}>
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8" 
                    fontSize={10} 
                    tickFormatter={(val) => new Date(val).toLocaleDateString('ar-JO', { weekday: 'short' })}
                  />
                  <YAxis stroke="#94a3b8" fontSize={10} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    formatter={(val) => [formatCurrencyArabic(val), 'الأرباح']}
                    labelFormatter={(val) => new Date(val).toLocaleDateString('ar-JO')}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorRev)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* 🍔 Top Selling Items List */}
        <div className="space-y-8">
           <ChartCard title="الوجبات الأكثر طلباً" icon={<BarChart3 className="w-4 h-4" />}>
              <div className="h-[300px] w-full mb-8">
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
              </div>

              <div className="space-y-3">
                {data?.topItems?.map((item, idx) => (
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

           <div className="bg-gradient-to-br from-primary/20 to-primary/5 p-6 rounded-3xl border border-primary/20 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 blur-3xl -mr-16 -mt-16 group-hover:bg-primary/30 transition-all"></div>
              <h4 className="text-white font-bold text-lg mb-2 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                توصية الذكاء الاصطناعي
              </h4>
              <p className="text-text-muted text-sm leading-relaxed">
                بناءً على ساعات الذروة (الساعة {data?.peakHours?.sort((a,b) => b.count - a.count)[0]?.hour}:00)، نقترح زيادة عدد الموظفين في هذا التوقيت لضمان سرعة التحضير.
              </p>
           </div>
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

const ChartCard = ({ title, icon, children }) => (
  <div className="bg-card/40 backdrop-blur-md p-6 rounded-3xl border border-white/5 shadow-2xl">
    <div className="flex items-center gap-2 mb-6 border-b border-white/5 pb-4">
      <div className="p-2 rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-white">{title}</h3>
    </div>
    {children}
  </div>
);

export default Analytics;
