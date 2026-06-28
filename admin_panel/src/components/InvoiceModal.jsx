import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Printer, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatCurrencyArabic } from '../lib/formatters';
import { format } from 'date-fns';

const InvoiceModal = ({ order, isOpen, onClose }) => {
  const qrRef = useRef(null);

  const handlePrint = () => {
    if (!order) return;

    try {
      const branchName = order.branch?.name || order.restaurantName || "المركزية";
      const branchAddress = order.branch?.address || (order.restaurantName ? "" : "الاردن");
      const taxNumber = order.branch?.taxNumber || order.taxNumber || "312345678900003";
      const phone = order.branch?.phone || order.phone || "";
      
      const orderId = order.id || order.orderId || "";
      
      let formattedDate = '';
      try {
        const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
        if (isNaN(createdAt.getTime())) {
          formattedDate = new Date().toLocaleString('en-US');
        } else {
          formattedDate = format(createdAt, 'yyyy/MM/dd HH:mm');
        }
      } catch (e) {
        formattedDate = new Date().toLocaleString('en-US');
      }

      const orderTypeLabel = order.orderType === 'delivery' ? 'توصيل' : 'استلام';
      const customerName = order.customerName || order.customer?.name || '';
      const customerPhone = order.customerPhone || order.customer?.phone || '';
      
      const items = order.cartItems || order.orderItems || order.items || [];
      const subtotal = order.subtotal || 0;
      const deliveryFee = order.deliveryFee || 0;
      const total = order.total || order.totalPrice || 0;

      // Get QR Code SVG HTML from the DOM, with a fallback if not rendered yet
      const qrValue = order.signedQr || `https://almarkazia.app/order/${orderId}`;
      const qrSvg = (qrRef.current && qrRef.current.innerHTML) 
        ? qrRef.current.innerHTML 
        : `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrValue)}" width="150" height="150" alt="QR Code" />`;

      const itemsHtml = items.map(item => {
        const qty = item.qty || item.quantity || 1;
        const price = Number(item.price || item.unitPrice || 0);
        const lineTotal = item.lineTotal !== undefined ? Number(item.lineTotal) : (price * qty);
        const options = item.optionsText || item.selectedOptions || (Array.isArray(item.modifiers) && item.modifiers.length > 0 ? item.modifiers.map(m => m.name || m.title || String(m)).join('، ') : '');
        const itemNote = item.notes || item.note || '';
        return `
          <tr>
            <td style="padding-top: 6px; font-size: 14px; font-weight: bold; text-align: right;">
              ${item.title || item.name || item.itemName || 'صنف'}
              ${options ? `<div style="font-size: 11px; font-weight: normal; color: #555; margin-top: 2px;">+ ${options}</div>` : ''}
              ${itemNote ? `<div style="font-size: 11px; font-style: italic; color: #d97706; margin-top: 2px;">⚠️ ملاحظة: ${itemNote}</div>` : ''}
            </td>
            <td style="padding-top: 6px; text-align: center; font-size: 14px;">${qty}</td>
            <td style="padding-top: 6px; text-align: left; font-size: 14px; font-weight: bold;">${formatCurrencyArabic(lineTotal)}</td>
          </tr>
        `;
      }).join('');

      const htmlContent = `
        <!DOCTYPE html>
        <html dir="rtl">
          <head>
            <meta charset="utf-8">
            <title>Invoice-${orderId}</title>
            <style>
              @page {
                size: 80mm auto;
                margin: 0;
              }
              html, body {
                margin: 0;
                padding: 0;
                background-color: #fff;
                color: #000;
              }
              body {
                width: 80mm;
                box-sizing: border-box;
                font-family: 'Arial', 'Tahoma', sans-serif;
                padding: 4mm 6mm;
                font-size: 13px;
                line-height: 1.4;
              }
              .text-center { text-align: center; }
              .text-left { text-align: left; }
              .text-right { text-align: right; }
              .font-bold { font-weight: bold; }
              
              .header h2 {
                font-size: 22px;
                margin: 0 0 6px 0;
                font-weight: 900;
              }
              .header p {
                margin: 2px 0;
                font-size: 13px;
              }
              
              hr {
                border: none;
                border-top: 1px dashed #000;
                margin: 10px 0;
              }
              
              .info-table {
                width: 100%;
                margin-bottom: 8px;
              }
              .info-table td {
                padding: 2px 0;
                font-size: 13px;
              }
              
              .items-table {
                width: 100%;
                border-collapse: collapse;
              }
              .items-table th {
                border-bottom: 1px solid #000;
                padding-bottom: 6px;
                font-size: 13px;
              }
              .items-table td {
                vertical-align: top;
              }
              
              .totals {
                width: 100%;
                margin-top: 8px;
              }
              .totals td {
                padding: 3px 0;
                font-size: 13px;
              }
              .totals .grand-total {
                font-size: 15px;
                font-weight: 900;
                border-top: 1px solid #000;
                padding-top: 6px;
              }
              
              .qr-container {
                display: flex;
                justify-content: center;
                margin: 15px 0 10px 0;
              }
              .qr-container svg {
                width: 40mm;
                height: 40mm;
              }
            </style>
          </head>
          <body>
            <div class="header text-center">
              <h2>${branchName}</h2>
              ${branchAddress ? `<p>${branchAddress}</p>` : ''}
              ${phone ? `<p>الهاتف: ${phone}</p>` : ''}
              <p>الرقم الضريبي: ${taxNumber}</p>
            </div>
            
            <hr />
            
            <table class="info-table">
              <tr>
                <td class="font-bold">رقم الطلب:</td>
                <td class="text-left">${String(orderId).substring(0, 8)}</td>
              </tr>
              <tr>
                <td class="font-bold">التاريخ:</td>
                <td class="text-left">${formattedDate}</td>
              </tr>
              <tr>
                <td class="font-bold">نوع الطلب:</td>
                <td class="text-left">${orderTypeLabel}</td>
              </tr>
              ${customerName ? `
                <tr>
                  <td class="font-bold">العميل:</td>
                  <td class="text-left">${customerName}</td>
                </tr>
              ` : ''}
              ${customerPhone ? `
                <tr>
                  <td class="font-bold">الهاتف:</td>
                  <td class="text-left">${customerPhone}</td>
                </tr>
              ` : ''}
              ${order.notes ? `
                <tr>
                  <td class="font-bold" style="color: #d97706; padding-top: 4px;">ملاحظات الطلب:</td>
                  <td class="text-left" style="color: #d97706; font-weight: bold; padding-top: 4px;">${order.notes}</td>
                </tr>
              ` : ''}
            </table>
            
            <hr />
            
            <table class="items-table">
              <thead>
                <tr>
                  <th class="text-right">الصنف</th>
                  <th class="text-center" style="width: 15%;">الكمية</th>
                  <th class="text-left" style="width: 25%;">السعر</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
            
            <hr />
            
            <table class="totals">
              <tr>
                <td>المجموع الفرعي</td>
                <td class="text-left font-bold">${formatCurrencyArabic(subtotal)}</td>
              </tr>
              ${deliveryFee > 0 ? `
                <tr>
                  <td>رسوم التوصيل</td>
                  <td class="text-left font-bold">${formatCurrencyArabic(deliveryFee)}</td>
                </tr>
              ` : ''}
              <tr class="grand-total">
                <td>الإجمالي الكلي (شامل الضريبة)</td>
                <td class="text-left">${formatCurrencyArabic(total)}</td>
              </tr>
            </table>
            
            <hr />
            
            <div class="qr-container text-center">
              ${qrSvg}
            </div>
            
            <p class="text-center" style="font-size: 13px; margin: 10px 0 0 0; font-weight: bold;">شكراً لزيارتكم</p>
          </body>
        </html>
      `;

      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      
      iframe.contentWindow.document.open();
      iframe.contentWindow.document.write(htmlContent);
      iframe.contentWindow.document.close();
      
      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 1000);
      }, 500);

    } catch (error) {
      console.error("Print failed:", error);
      alert("حدث خطأ أثناء محاولة الطباعة: " + error.message);
    }
  };

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
              {order.notes && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-xl mb-4 text-right">
                  <strong>⚠️ ملاحظات العميل:</strong> {order.notes}
                </div>
              )}
              {(order.cartItems || order.orderItems || order.items || []).map((item, i) => {
                const qty = item.qty || item.quantity || 1;
                const price = Number(item.price || 0);
                const lineTotal = item.lineTotal !== undefined ? Number(item.lineTotal) : (price * qty);
                const itemNote = item.notes || item.note;
                return (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-700">{qty}x {item.title || item.name}</span>
                      {item.optionsText && <span className="text-[10px] text-slate-400">{item.optionsText}</span>}
                      {itemNote && <span className="text-[10px] text-amber-600 font-medium">⚠️ {itemNote}</span>}
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
              <div ref={qrRef} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner">
                <QRCodeSVG
                  value={order.signedQr || `https://almarkazia.app/order/${order.id}`}
                  size={100}
                  fgColor="#0f172a"
                />
              </div>
              <p className="text-[8px] text-slate-400 text-center font-bold uppercase tracking-widest text-[#0F172A] opacity-60">امسح الكود لتتبع حالة الطلب</p>
            </div>

            <button
              onClick={() => handlePrint()}
              className="mt-8 w-full bg-slate-900 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg"
            >
              <Printer className="w-5 h-5" />
              <span>طباعة الفاتورة الحرارية</span>
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default InvoiceModal;
