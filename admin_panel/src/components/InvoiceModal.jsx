import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Printer, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatCurrencyArabic } from '../lib/formatters';
import { useReactToPrint } from 'react-to-print';
import { ThermalInvoiceTemplate } from './ThermalInvoiceTemplate';

const InvoiceModal = ({ order, isOpen, onClose }) => {
  const componentRef = useRef(null);

  const handlePrint = useReactToPrint({
    contentRef: () => componentRef.current,
    documentTitle: `Invoice-${order?.id || 'order'}`,
    pageStyle: `@page { size: 80mm auto; margin: 0; } body { margin: 0; padding: 0; }`,
    onAfterPrint: () => console.log('Print success'),
  });

  if (!order) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative bg-white text-slate-900 w-full max-w-sm rounded-2xl p-8 shadow-2xl flex flex-col items-center"
          >
            {/* Close button */}
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-6 flex flex-col items-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-primary">
                <Package className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold font-mono tracking-tight uppercase">فاتورة شراء</h3>
              <span className="text-[10px] font-mono text-text-muted">#{String(order.orderNumber || order.id).slice(0, 8)}</span>
            </div>

            <div className="w-full space-y-3 mb-8 border-y border-dashed border-slate-200 py-6 max-h-[40vh] overflow-y-auto pr-2">
              {(order.cartItems || order.orderItems || order.items || []).map((item, i) => {
                const qty = item.qty || item.quantity || 1;
                const price = Number(item.price || 0);
                const lineTotal = item.lineTotal !== undefined ? Number(item.lineTotal) : (price * qty);
                return (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-700">{qty}x {item.title || item.name}</span>
                      {item.optionsText && <span className="text-[10px] text-slate-400">{item.optionsText}</span>}
                    </div>
                    <span className="font-bold">{formatCurrencyArabic(lineTotal)}</span>
                  </div>
                );
              })}
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>المجموع الفرعي</span>
                  <span>{formatCurrencyArabic(order.subtotal || 0)}</span>
                </div>
                {(order.deliveryFee > 0) && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>رسوم التوصيل</span>
                    <span>{formatCurrencyArabic(order.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-center py-2 text-[10px] text-slate-400 font-bold">
                  الأسعار شاملة ضريبة المبيعات
                </div>
                <div className="flex justify-between font-black text-lg pt-2 text-slate-900 border-t border-slate-50">
                  <span>الإجمالي الكلي</span>
                  <span className="text-primary">{formatCurrencyArabic(order.totalPrice || order.total || 0)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4">
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner">
                <QRCodeSVG
                  value={`https://almarkazia.app/order/${order.id}`}
                  size={100}
                  fgColor="#0f172a"
                />
              </div>
              <p className="text-[8px] text-slate-400 text-center font-bold uppercase tracking-widest text-[#0F172A] opacity-60">امسح الكود لتتبع حالة الطلب</p>
            </div>

            <button
              onClick={() => {
                // Fallback to window.print if handlePrint is somehow failing
                setTimeout(() => window.print(), 100);
              }}
              className="mt-8 w-full bg-slate-900 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg"
            >
              <Printer className="w-5 h-5" />
              <span>طباعة الفاتورة الحرارية</span>
            </button>
          </motion.div>
        </div>
      )}
      
      {/* Global Print Styles and Hidden Thermal Template */}
      {isOpen && (
        <>
          <style type="text/css">
            {`
              @media print {
                body * {
                  visibility: hidden;
                }
                #printable-thermal-receipt, #printable-thermal-receipt * {
                  visibility: visible;
                }
                #printable-thermal-receipt {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 80mm;
                  margin: 0;
                  padding: 0;
                  display: block !important;
                }
                @page {
                  size: 80mm auto;
                  margin: 0;
                }
              }
            `}
          </style>
          <div id="printable-thermal-receipt" style={{ display: 'none' }} className="print:block">
            <ThermalInvoiceTemplate ref={componentRef} order={order} />
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default InvoiceModal;
