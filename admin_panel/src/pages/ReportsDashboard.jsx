import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, Package, DollarSign, Wallet, FileText, Activity, AlertCircle, Percent, Truck } from 'lucide-react';
import { motion } from 'framer-motion';
import api from "../api/client";
import { formatCurrencyArabic } from "../lib/formatters";

const StatCard = ({ title, value, icon, gradientFrom, gradientTo, delay }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.5, ease: "easeOut" }}
    className="bg-card/40 backdrop-blur-xl p-6 rounded-3xl border border-white/5 relative overflow-hidden group hover:border-white/10 transition-all shadow-xl hover:shadow-2xl"
  >
    <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-all bg-gradient-to-br ${gradientFrom} ${gradientTo}`} />
    <div className="flex items-center gap-5 relative z-10">
      <div className={`p-4 rounded-2xl shadow-inner ring-1 ring-white/20 bg-gradient-to-br ${gradientFrom} ${gradientTo} text-white`}>
        {icon}
      </div>
      <div>
        <p className="text-text-muted text-sm font-semibold tracking-wide mb-1">{title}</p>
        <h3 className="text-2xl lg:text-3xl font-black text-white tracking-tight">{value}</h3>
      </div>
    </div>
  </motion.div>
);

export default function ReportsDashboard() {
  const [dailyReports, setDailyReports] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      const [reportsRes, itemsRes] = await Promise.all([
        api.get(`/reports/daily?days=${days}`),
        api.get('/reports/top-items')
      ]);
      
      const formattedReports = (reportsRes.data || []).map(r => ({
        ...r,
        displayDate: new Date(r.date).toLocaleDateString('ar-IQ', { weekday: 'short', month: 'short', day: 'numeric' })
      }));
      
      setDailyReports(formattedReports);
      setTopItems(itemsRes.data || []);
    } catch (err) {
      console.error('Failed to fetch reports', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Derive aggregates from the snapshot data
  const totalGross = dailyReports.reduce((sum, r) => sum + (Number(r.totalRevenue) || 0), 0);
  const totalNet = dailyReports.reduce((sum, r) => sum + (Number(r.netRevenue) || 0), 0);
  const totalBase = dailyReports.reduce((sum, r) => sum + (Number(r.baseRevenue) || 0), 0);
  const totalTax = dailyReports.reduce((sum, r) => sum + (Number(r.taxTotal) || 0), 0);
  const totalDelivery = dailyReports.reduce((sum, r) => sum + (Number(r.deliveryTotal) || 0), 0);
  const totalDiscounts = dailyReports.reduce((sum, r) => sum + (Number(r.discountTotal) || 0), 0);
  const totalLoss = dailyReports.reduce((sum, r) => sum + (Number(r.lossTotal) || 0), 0);
  const totalOrders = dailyReports.reduce((sum, r) => sum + (Number(r.orderCount) || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 min-h-screen">
      {/* Header section with glassmorphism */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-card/30 backdrop-blur-md p-6 lg:p-8 rounded-3xl border border-white/5"
      >
        <div>
          <h1 className="text-3xl lg:text-4xl font-black text-white flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-primary to-orange-500 rounded-2xl shadow-lg shadow-primary/20">
              <TrendingUp className="w-8 h-8 text-white" />
            </div>
            التقارير المالية الشاملة
          </h1>
          <p className="text-text-muted mt-3 text-sm lg:text-base font-medium pr-16">
            تحليل متقدم للمبيعات، الإيرادات الإجمالية، الأرباح الصافية، والضرائب عبر كل الفروع
          </p>
        </div>
        <div className="bg-background-light/80 p-1.5 rounded-2xl border border-white/10 flex items-center shadow-inner self-stretch lg:self-auto">
          {[7, 30, 90].map((val) => (
            <button
              key={val}
              onClick={() => setDays(val)}
              className={`flex-1 lg:flex-none px-6 py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                days === val 
                ? 'bg-gradient-to-r from-primary to-orange-500 text-white shadow-lg shadow-primary/30' 
                : 'text-text-muted hover:text-white hover:bg-white/5'
              }`}
            >
              {val === 7 ? 'آخر أسبوع' : val === 30 ? 'آخر شهر' : 'آخر 3 أشهر'}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Main KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard 
          title="الإيراد الإجمالي (Gross)" 
          value={formatCurrencyArabic(totalGross)} 
          icon={<DollarSign className="w-7 h-7" />} 
          gradientFrom="from-emerald-500"
          gradientTo="to-teal-600"
          delay={0.1}
        />
        <StatCard 
          title="صافي الأرباح (Base)" 
          value={formatCurrencyArabic(totalBase)} 
          icon={<Wallet className="w-7 h-7" />} 
          gradientFrom="from-blue-500"
          gradientTo="to-indigo-600"
          delay={0.2}
        />
        <StatCard 
          title="ضريبة القيمة المضافة" 
          value={formatCurrencyArabic(totalTax)} 
          icon={<FileText className="w-7 h-7" />} 
          gradientFrom="from-amber-400"
          gradientTo="to-orange-500"
          delay={0.3}
        />
        <StatCard 
          title="إجمالي الطلبات الناجحة" 
          value={totalOrders.toLocaleString('ar-IQ')} 
          icon={<Package className="w-7 h-7" />} 
          gradientFrom="from-primary"
          gradientTo="to-rose-500"
          delay={0.4}
        />
      </div>

      {/* Secondary KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="bg-card/20 backdrop-blur-sm p-5 rounded-2xl border border-white/5 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-500/10 rounded-xl">
              <Truck className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <p className="text-text-muted text-xs font-semibold mb-1">إيرادات التوصيل</p>
              <h4 className="text-xl font-bold text-white">{formatCurrencyArabic(totalDelivery)}</h4>
            </div>
          </div>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 }} className="bg-card/20 backdrop-blur-sm p-5 rounded-2xl border border-white/5 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-pink-500/10 rounded-xl">
              <Percent className="w-6 h-6 text-pink-400" />
            </div>
            <div>
              <p className="text-text-muted text-xs font-semibold mb-1">إجمالي الخصومات الممنوحة</p>
              <h4 className="text-xl font-bold text-white">{formatCurrencyArabic(totalDiscounts)}</h4>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.7 }} className="bg-card/20 backdrop-blur-sm p-5 rounded-2xl border border-white/5 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-500/10 rounded-xl">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <p className="text-text-muted text-xs font-semibold mb-1">خسائر الطلبات الملغاة (Loss)</p>
              <h4 className="text-xl font-bold text-white">{formatCurrencyArabic(totalLoss)}</h4>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="lg:col-span-2 bg-card/40 backdrop-blur-xl p-6 lg:p-8 rounded-3xl border border-white/5 relative overflow-hidden shadow-2xl"
        >
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
          <h3 className="text-xl font-black text-white mb-8 flex items-center gap-3">
            <Activity className="w-6 h-6 text-emerald-400" />
            منحنى الإيرادات والنمو
          </h3>
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyReports} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.6}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorBase" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="displayDate" stroke="#888" fontSize={12} tickLine={false} axisLine={false} dy={15} />
                <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val / 1000}k`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5)' }}
                  itemStyle={{ color: '#fff', fontWeight: 'bold', padding: '4px 0' }}
                  labelStyle={{ color: '#94a3b8', marginBottom: '8px', fontSize: '13px' }}
                  formatter={(value) => formatCurrencyArabic(value)}
                />
                <Legend verticalAlign="top" height={40} iconType="circle" wrapperStyle={{ paddingBottom: '20px' }} />
                <Area type="monotone" dataKey="totalRevenue" name="الإيراد الإجمالي (Gross)" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorGross)" activeDot={{ r: 6, strokeWidth: 0, fill: '#10b981' }} />
                <Area type="monotone" dataKey="baseRevenue" name="الربح الصافي (Base)" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorBase)" activeDot={{ r: 6, strokeWidth: 0, fill: '#3b82f6' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="bg-card/40 backdrop-blur-xl p-6 lg:p-8 rounded-3xl border border-white/5 relative overflow-hidden shadow-2xl flex flex-col"
        >
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <h3 className="text-xl font-black text-white mb-8 flex items-center gap-3">
            <Package className="w-6 h-6 text-primary" />
            الأصناف الأكثر مبيعاً
          </h3>
          <div className="h-[380px] w-full flex-grow">
            {topItems.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 0, left: 60, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" horizontal={true} vertical={false} />
                  <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis dataKey="title" type="category" stroke="#e2e8f0" fontSize={12} width={120} tickLine={false} axisLine={false} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  />
                  <Bar dataKey="_sum.quantity" name="الكمية المباعة" radius={[0, 6, 6, 0]} barSize={24}>
                    {topItems.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={['#f97316', '#eab308', '#3b82f6', '#10b981', '#8b5cf6'][index % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <Package className="w-16 h-16 opacity-20 mb-4" />
                <p>لا توجد بيانات متاحة حالياً</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
