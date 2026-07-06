import React, { useState, useEffect } from 'react';
import { 
  X, User, Phone, Mail, Award, Wallet, ShieldAlert, 
  ShoppingBag, History, Loader2
} from 'lucide-react';
import api from '../api/client';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

export default function Customer360({ customerId, isOpen, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (isOpen && customerId) {
      fetch360Data();
    }
  }, [isOpen, customerId]);

  const fetch360Data = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/crm/customers/${customerId}/360`);
      const body = res.data?.data || res.data || null;
      setData(body);
    } catch (err) {
      console.error(err);
      toast.error('فشل في جلب بيانات العميل 360°');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
        {/* Backdrop click to close */}
        <div className="absolute inset-0" onClick={onClose} />

        {/* Drawer container */}
        <motion.div 
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-2xl h-full bg-white/95 backdrop-blur-xl border-r border-white/20 shadow-2xl flex flex-col z-10"
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
                <User className="text-primary w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">بروفايل العميل الشامل 360°</h2>
                <p className="text-xs text-gray-500">رؤية كاملة للمبيعات، الطلبات، الولاء والنشاط</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-gray-500 animate-pulse">جاري جلب ملف العميل...</p>
            </div>
          ) : !data ? (
            <div className="flex-1 flex flex-col items-center justify-center opacity-50">
              <User className="w-12 h-12 text-gray-400 mb-2" />
              <p className="text-sm">لم يتم العثور على بيانات هذا العميل</p>
            </div>
          ) : (
            <>
              {/* Profile Card Summary */}
              <div className="p-6 bg-gray-50/50 border-b border-gray-100">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{data.customer.name}</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className={cn(
                        "px-2.5 py-0.5 rounded-full text-xs font-semibold",
                        data.customer.tier === 'PLATINUM' ? 'bg-purple-100 text-purple-700' :
                        data.customer.tier === 'GOLD' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      )}>
                        فئة {data.customer.tier === 'PLATINUM' ? 'بلاتيني' : data.customer.tier === 'GOLD' ? 'ذهبي' : 'فضي'}
                      </span>
                      {data.customer.isBlacklisted && (
                        <span className="px-2.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3" /> محظور
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-left">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold shadow-sm border",
                      data.customer.riskScore > 5 ? 'bg-red-50 text-red-600 border-red-100' :
                      data.customer.riskScore > 2 ? 'bg-orange-50 text-orange-600 border-orange-100' :
                      'bg-green-50 text-green-600 border-green-100'
                    )}>
                      مستوى الخطورة: {data.customer.riskScore}
                    </span>
                  </div>
                </div>

                {/* Quick Stats Grid */}
                <div className="grid grid-cols-3 gap-4 mt-6">
                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
                      <ShoppingBag className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400">إجمالي الطلبات</p>
                      <p className="text-sm font-bold text-gray-800">{data.customer.totalOrders}</p>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-yellow-50 flex items-center justify-center text-yellow-600">
                      <Award className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400">نقاط الولاء</p>
                      <p className="text-sm font-bold text-gray-800">{data.customer.points}</p>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400">رصيد المحفظة</p>
                      <p className="text-sm font-bold text-gray-800">${parseFloat(data.customer.walletBalance).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabs Navigation */}
              <div className="flex border-b border-gray-100 px-6 bg-white flex-shrink-0">
                {[
                  { id: 'overview', name: 'نظرة عامة', icon: User },
                  { id: 'orders', name: 'الطلبات', icon: ShoppingBag },
                  { id: 'timeline', name: 'التواصل والصفقات', icon: History },
                  { id: 'loyalty', name: 'الولاء والتقييمات', icon: Award }
                ].map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex items-center gap-2 py-4 px-4 border-b-2 font-semibold text-xs transition-all outline-none",
                        activeTab === tab.id
                          ? "border-primary text-primary"
                          : "border-transparent text-gray-400 hover:text-gray-600"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab Contents */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    {/* Customer Info Card */}
                    <div className="bg-white border border-gray-100 rounded-3xl p-6 space-y-4 shadow-sm">
                      <h4 className="font-bold text-gray-800 text-sm">تفاصيل الاتصال</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center gap-3">
                          <Phone className="w-4 h-4 text-gray-400" />
                          <div>
                            <p className="text-[10px] text-gray-400">رقم الهاتف</p>
                            <p className="text-xs font-semibold text-gray-700">{data.customer.phone || 'غير مسجل'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Mail className="w-4 h-4 text-gray-400" />
                          <div>
                            <p className="text-[10px] text-gray-400">البريد الإلكتروني</p>
                            <p className="text-xs font-semibold text-gray-700">{data.customer.email || 'غير مسجل'}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Lead Conversion History */}
                    {data.customer.leadsConverted && (
                      <div className="bg-purple-50/50 border border-purple-100 rounded-3xl p-6 shadow-sm">
                        <h4 className="font-bold text-purple-800 text-sm mb-3">سجل تحويل العميل (Lead Conversion)</h4>
                        <div className="space-y-2">
                          <p className="text-xs text-gray-600">
                            تم تحويل هذا الحساب من عميل محتمل يحمل الاسم <span className="font-semibold">{data.customer.leadsConverted.name}</span>.
                          </p>
                          <p className="text-xs text-gray-500">
                            الحالة السابقة: <span className="font-medium text-purple-700">{data.customer.leadsConverted.status}</span>
                          </p>
                          {data.customer.leadsConverted.opportunities?.length > 0 && (
                            <div className="mt-4 pt-3 border-t border-purple-100">
                              <p className="text-xs font-bold text-purple-800 mb-2">الصفقات المرتبطة بالـ Lead:</p>
                              <div className="space-y-2">
                                {data.customer.leadsConverted.opportunities.map(opp => (
                                  <div key={opp.id} className="flex justify-between items-center bg-white p-2 rounded-xl border border-purple-100 text-xs">
                                    <span className="font-semibold text-gray-700">{opp.title}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{opp.stage}</span>
                                      <span className="font-bold text-primary">${opp.value}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'orders' && (
                  <div className="space-y-4">
                    <h4 className="font-bold text-gray-800 text-sm">آخر 10 طلبات</h4>
                    {data.recentOrders?.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6">لا يوجد طلبات سابقة للعميل</p>
                    ) : (
                      <div className="space-y-3">
                        {data.recentOrders.map(order => (
                          <div key={order.id} className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-primary/20 transition-all">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-500">
                                <ShoppingBag className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-gray-800">طلب #{order.orderNumber}</p>
                                <p className="text-[10px] text-gray-400">
                                  {format(new Date(order.createdAt), 'dd MMMM yyyy, h:mm a', { locale: ar })}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={cn(
                                "px-2.5 py-0.5 rounded-full text-[10px] font-semibold",
                                order.status === 'DELIVERED' ? 'bg-green-50 text-green-700' :
                                order.status === 'CANCELLED' ? 'bg-red-50 text-red-700' :
                                'bg-blue-50 text-blue-700'
                              )}>
                                {order.status}
                              </span>
                              <span className="text-sm font-bold text-gray-900">${parseFloat(order.total).toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'timeline' && (
                  <div className="space-y-6">
                    {/* Opportunities Section */}
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm mb-3">الصفقات النشطة (Opportunities)</h4>
                      {data.opportunities?.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">لا توجد صفقات حالية لهذا العميل</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {data.opportunities.map(opp => (
                            <div key={opp.id} className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-primary/20 transition-all">
                              <div className="flex justify-between items-start">
                                <h5 className="font-bold text-gray-800 text-xs">{opp.title}</h5>
                                <span className="text-xs font-black text-primary">${opp.value}</span>
                              </div>
                              <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-50 text-[10px]">
                                <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full font-semibold">{opp.stage}</span>
                                <span className="text-gray-400">
                                  أنشئت: {format(new Date(opp.createdAt), 'dd/MM/yyyy')}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Sales Activity Timeline */}
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm mb-4">سجل المتابعة والتواصل (Timeline)</h4>
                      {data.activities?.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">لا يوجد أنشطة تواصل مسجلة</p>
                      ) : (
                        <div className="relative border-r-2 border-gray-100 pr-6 space-y-6">
                          {data.activities.map(activity => (
                            <div key={activity.id} className="relative">
                              {/* Marker */}
                              <div className="absolute -right-[31px] top-1 w-4.5 h-4.5 rounded-full bg-white border-2 border-primary flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                              </div>

                              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[9px] font-bold">
                                      {activity.type}
                                    </span>
                                    <h5 className="font-bold text-gray-800 text-xs">{activity.subject || 'بدون عنوان'}</h5>
                                  </div>
                                  <span className="text-[10px] text-gray-400">
                                    {format(new Date(activity.activityDate), 'dd MMM, h:mm a', { locale: ar })}
                                  </span>
                                </div>
                                {activity.notes && (
                                  <p className="text-xs text-gray-600 mt-2 bg-gray-50 p-2.5 rounded-xl border border-gray-100/50">
                                    {activity.notes}
                                  </p>
                                )}
                                <div className="text-[9px] text-gray-400 mt-2 flex items-center gap-1.5 justify-end">
                                  <span>بواسطة: {activity.performedBy.role}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'loyalty' && (
                  <div className="space-y-6">
                    {/* Loyalty History */}
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm mb-3">حركات الولاء والنقاط</h4>
                      {data.loyaltyLedgers?.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">لا يوجد حركات ولاء مسجلة</p>
                      ) : (
                        <div className="space-y-2.5">
                          {data.loyaltyLedgers.map(entry => (
                            <div key={entry.id} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
                              <div>
                                <span className={cn(
                                  "px-2 py-0.5 rounded-lg text-[9px] font-bold ml-2",
                                  entry.transactionType === 'ORDER_AWARD' ? 'bg-green-50 text-green-700' :
                                  entry.transactionType === 'REVIEW_AWARD' ? 'bg-blue-50 text-blue-700' :
                                  'bg-red-50 text-red-700'
                                )}>
                                  {entry.transactionType}
                                </span>
                                <span className="text-xs text-gray-600">{entry.description}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "font-bold text-xs",
                                  entry.points > 0 ? 'text-green-600' : 'text-red-600'
                                )}>
                                  {entry.points > 0 ? `+${entry.points}` : entry.points} نقطة
                                </span>
                                <span className="text-[9px] text-gray-400">
                                  {format(new Date(entry.createdAt), 'dd/MM/yyyy')}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Customer Reviews */}
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm mb-3">تقييمات الوجبات والخدمة</h4>
                      {data.reviews?.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">لم يكتب العميل أي تقييم بعد</p>
                      ) : (
                        <div className="space-y-3">
                          {data.reviews.map(review => (
                            <div key={review.id} className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                              <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-1 text-yellow-500">
                                  {'★'.repeat(review.rating)}
                                  {'☆'.repeat(5 - review.rating)}
                                </div>
                                <span className="text-[9px] text-gray-400">
                                  {format(new Date(review.createdAt), 'dd MMMM yyyy', { locale: ar })}
                                </span>
                              </div>
                              {review.comment && (
                                <p className="text-xs text-gray-600 italic">"{review.comment}"</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
