import { useState, useEffect } from 'react';
import { Download, FileText, Table as TableIcon, Calendar, TrendingUp, DollarSign, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/Header';
import api from '../api/client';
import { cn } from '../lib/utils';
import { formatCurrencyArabic } from '../lib/formatters';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const Reports = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // Default to start of current month
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/orders/report?startDate=${startDate}&endDate=${endDate}`);
      setData(Array.isArray(data) ? data : []);
    } catch (error) {
       toast.error('فشل في تحميل بيانات التقارير');
       console.error('Fetch reports error:', error);
       setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [startDate, endDate]);

  const getTopItemsForPeriod = () => {
    const itemCounts = {};
    data.forEach(order => {
      if (order.cartItems && Array.isArray(order.cartItems)) {
        order.cartItems.forEach(item => {
          const key = item.itemName || item.title || 'صنف غير معروف';
          if (!itemCounts[key]) itemCounts[key] = { name: key, orders: 0, revenue: 0 };
          itemCounts[key].orders += (item.quantity || item.qty || 1);
          itemCounts[key].revenue += Number(item.lineTotal) || 0;
        });
      }
    });

    return Object.values(itemCounts)
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5);
  };

  const topItems = getTopItemsForPeriod();

  const summary = {
    totalSales: data.reduce((acc, curr) => acc + (Number(curr.totalPrice) || 0), 0),
    orderCount: data.length,
    avgValue: data.length > 0
      ? (data.reduce((acc, curr) => acc + (Number(curr.totalPrice) || 0), 0) / data.length)
      : 0,
    completedCount: data.filter(o => o.status === 'delivered').length
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(data.map(order => ({
      'رقم الطلب': order.orderNumber,
      'العميل': order.customerName,
      'التاريخ': new Date(order.createdAt).toLocaleDateString('ar-JO'),
      'المبلغ': Number(order.totalPrice) || 0,
      'الحالة': order.status,
      'النوع': order.orderType
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Report");
    XLSX.writeFile(wb, "Restaurant_Sales_Report.xlsx");
    toast.success('تم تصدير ملف Excel بنجاح');
  };

  const exportToPDF = () => {
    const doc = new jsPDF('p', 'pt');
    doc.setFont("helvetica");
    doc.text(`Sales Report (${startDate} to ${endDate})`, 40, 40);
    
    const tableData = data.map(order => [
      order.orderNumber,
      order.customerName,
      new Date(order.createdAt).toLocaleDateString('en-US'),
      formatCurrencyArabic(order.totalPrice),
      order.status
    ]);

    doc.autoTable({
      head: [['Order ID', 'Customer', 'Date', 'Amount', 'Status']],
      body: tableData,
      startY: 60,
    });

    doc.save("Sales_Report.pdf");
    toast.success('تم تصدير ملف PDF بنجاح');
  };

  const statusLabel = (status) => {
    const map = {
      'delivered': { text: 'مكتمل', style: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
      'cancelled': { text: 'ملغي', style: 'bg-red-500/10 text-red-500 border-red-500/20' },
      'pending': { text: 'قيد الانتظار', style: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
      'confirmed': { text: 'مؤكد', style: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
      'preparing': { text: 'قيد التجهيز', style: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
      'ready': { text: 'جاهز', style: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' },
      'in_route': { text: 'في الطريق', style: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' },
    };
    return map[status] || { text: status, style: 'bg-white/5 text-text-muted border-white/10' };
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-screen pb-20">
      <Header 
        title="التقارير والتحليلات" 
        subtitle="استخرج بيانات المبيعات والأداء بشكل احترافي" 
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-10">
          <div className="bg-card/40 backdrop-blur-md p-6 rounded-2xl border border-white/5 flex flex-col justify-center">
            <p className="text-text-muted text-xs font-bold mb-1">إجمالي المبيعات المحققة</p>
            <div className="flex items-center gap-2">
               <DollarSign className="text-primary w-5 h-5" />
               <span className="text-2xl font-bold font-mono text-white tracking-tight">{formatCurrencyArabic(summary.totalSales)}</span>
            </div>
         </div>
         <div className="bg-card/40 backdrop-blur-md p-6 rounded-2xl border border-white/5 flex flex-col justify-center">
            <p className="text-text-muted text-xs font-bold mb-1">عدد الطلبات الكلي</p>
            <div className="flex items-center gap-2">
               <FileText className="text-blue-500 w-5 h-5" />
               <span className="text-2xl font-bold font-mono text-white tracking-tight">{summary.orderCount}</span>
            </div>
         </div>
         <div className="bg-card/40 backdrop-blur-md p-6 rounded-2xl border border-white/5 flex flex-col justify-center">
            <p className="text-text-muted text-xs font-bold mb-1">متوسط قيمة الطلب</p>
            <div className="flex items-center gap-2">
               <TrendingUp className="text-emerald-500 w-5 h-5" />
               <span className="text-2xl font-bold font-mono text-white tracking-tight">{formatCurrencyArabic(summary.avgValue)}</span>
            </div>
         </div>
         <div className="bg-card/40 backdrop-blur-md p-6 rounded-2xl border border-white/5 flex flex-col justify-center">
            <p className="text-text-muted text-xs font-bold mb-1">طلبات مكتملة</p>
            <div className="flex items-center gap-2">
               <Download className="text-purple-500 w-5 h-5" />
               <span className="text-2xl font-bold font-mono text-white tracking-tight">{summary.completedCount}</span>
            </div>
         </div>
      </div>

      <div className="bg-card/40 backdrop-blur-md rounded-3xl border border-white/5 overflow-hidden">
         {/* Table Header / Actions */}
         <div className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
               <div className="relative">
                  <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input 
                    type="date" 
                    className="glass-input pr-11 py-2 text-xs" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
               </div>
               <span className="text-text-muted">إلى</span>
               <div className="relative">
                  <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input 
                    type="date" 
                    className="glass-input pr-11 py-2 text-xs" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
               </div>
            </div>

            <div className="flex items-center gap-3">
               <button 
                 onClick={exportToExcel}
                 className="flex items-center gap-2 px-4 py-2 bg-[#1d6f42] text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/20 hover:opacity-90 active:scale-95 transition-all"
               >
                  <TableIcon className="w-4 h-4" />
                  Excel تصدير
               </button>
               <button 
                 onClick={exportToPDF}
                 className="flex items-center gap-2 px-4 py-2 bg-danger text-white rounded-xl text-sm font-bold shadow-lg shadow-red-900/20 hover:opacity-90 active:scale-95 transition-all"
               >
                  <FileText className="w-4 h-4" />
                  PDF تصدير
               </button>
            </div>
         </div>

         {/* Sales Table AND Top Items Sidebar */}
         <div className="grid grid-cols-1 xl:grid-cols-3 gap-0 border-t border-white/5">
            {/* Sidebar: Top Performing Items in chosen period */}
            <div className="p-8 border-l border-white/5 bg-black/10">
               <div className="flex items-center justify-between mb-8">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                     <TrendingUp className="w-4 h-4 text-primary" />
                     الأكثر مبيعاً في هذه الفترة
                  </h3>
               </div>
               
               <div className="space-y-4">
                  {topItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 opacity-30">
                       <TableIcon className="w-8 h-8 mb-3" />
                       <p className="text-[10px] font-black tracking-widest uppercase text-white">لا توجد بيانات لهذه الفترة</p>
                    </div>
                  ) : topItems.map((item, idx) => (
                    <div key={idx} className="group flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all duration-300">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-background border border-white/5 flex items-center justify-center text-[10px] font-bold text-primary shadow-inner">
                             {idx + 1}
                          </div>
                          <div>
                             <h4 className="text-white font-bold text-xs group-hover:text-primary transition-colors">{item.name}</h4>
                          </div>
                       </div>
                       <div className="text-left font-mono">
                          <p className="text-[10px] font-black text-white">{item.orders} <span className="text-[8px] text-text-muted">طلب</span></p>
                          <p className="text-[9px] text-primary">{formatCurrencyArabic(item.revenue)}</p>
                       </div>
                    </div>
                  ))}
               </div>
            </div>

            {/* Orders Table */}
            <div className="xl:col-span-2 overflow-x-auto">
               <table className="w-full text-right border-collapse">
                  <thead className="bg-white/5">
                     <tr className="border-b border-white/5">
                        <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-wider">رقم الطلب</th>
                        <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-wider">العميل</th>
                        <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-wider">التاريخ</th>
                        <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-wider">المبلغ</th>
                        <th className="px-6 py-4 text-xs font-bold text-text-muted uppercase tracking-wider text-center">الحالة</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                     {loading ? (
                        [1,2,3,4,5].map(i => (
                           <tr key={i} className="animate-pulse"><td colSpan="5" className="px-6 py-4 h-12 bg-white/5" /></tr>
                        ))
                     ) : (
                        data.map((order) => {
                          const st = statusLabel(order.status);
                          return (
                           <tr key={order.id} className="hover:bg-white/5 transition-colors group">
                              <td className="px-6 py-4 text-sm font-mono text-text-muted">{order.orderNumber}</td>
                              <td className="px-6 py-4 text-sm font-bold text-white group-hover:text-primary transition-colors">{order.customerName}</td>
                              <td className="px-6 py-4 text-sm text-text-muted">{new Date(order.createdAt).toLocaleDateString('en-US')}</td>
                              <td className="px-6 py-4 text-sm font-bold text-primary font-mono">{formatCurrencyArabic(order.totalPrice)}</td>
                              <td className="px-6 py-4 text-center">
                                 <span className={cn(
                                    "inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase border",
                                    st.style
                                 )}>
                                    {st.text}
                                 </span>
                              </td>
                           </tr>
                          );
                        })
                     )}
                  </tbody>
               </table>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Reports;
