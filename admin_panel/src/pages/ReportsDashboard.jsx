import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { Calendar, TrendingUp, Package, DollarSign } from 'lucide-react';
import api from "../api/client";
import { formatCurrencyArabic } from "../lib/formatters";

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

  const totalRevenue = dailyReports.reduce((sum, r) => sum + r.totalRevenue, 0);
  const totalOrders = dailyReports.reduce((sum, r) => sum + r.totalOrders, 0);

  if (loading) return <div className="p-8 text-center text-white">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-2">
            <TrendingUp className="w-8 h-8 text-primary" />
            تقارير الأداء
          </h1>
          <p className="text-text-muted mt-1">نظرة عامة على المبيعات والطلبات المؤرشفة</p>
        </div>
        <select 
          value={days} 
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-background-light border border-white/10 text-white rounded-xl px-4 py-2 focus:border-primary outline-none"
        >
          <option value={7}>آخر 7 أيام</option>
          <option value={30}>آخر 30 يوم</option>
          <option value={90}>آخر 3 أشهر</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-background-light p-6 rounded-2xl border border-white/5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500/20 text-emerald-500 rounded-xl">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className="text-text-muted text-sm font-medium">إجمالي الإيرادات</p>
              <h3 className="text-2xl font-black text-white">{formatCurrencyArabic(totalRevenue)}</h3>
            </div>
          </div>
        </div>

        <div className="bg-background-light p-6 rounded-2xl border border-white/5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 text-blue-500 rounded-xl">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <p className="text-text-muted text-sm font-medium">إجمالي الطلبات</p>
              <h3 className="text-2xl font-black text-white">{totalOrders}</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-background-light p-6 rounded-2xl border border-white/5">
          <h3 className="text-lg font-bold text-white mb-6">المبيعات اليومية</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyReports}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="displayDate" stroke="#888" fontSize={12} />
                <YAxis stroke="#888" fontSize={12} tickFormatter={(val) => `${val / 1000}k`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value) => formatCurrencyArabic(value)}
                />
                <Line type="monotone" dataKey="totalRevenue" name="المبيعات" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-background-light p-6 rounded-2xl border border-white/5">
          <h3 className="text-lg font-bold text-white mb-6">الأصناف الأكثر مبيعاً</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topItems} layout="vertical" margin={{ left: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                <XAxis type="number" stroke="#888" fontSize={12} />
                <YAxis dataKey="title" type="category" stroke="#888" fontSize={12} width={100} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                  cursor={{ fill: '#ffffff10' }}
                />
                <Bar dataKey="_sum.quantity" name="الكمية المباعة" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
