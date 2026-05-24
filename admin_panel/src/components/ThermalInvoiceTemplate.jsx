import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { generateZatcaQrCode } from '../lib/zatcaQr';
import { formatCurrencyArabic } from '../lib/formatters';
import { format } from 'date-fns';

export const ThermalInvoiceTemplate = React.forwardRef(({ order }, ref) => {
  if (!order) return null;

  // Assuming order has these properties directly or nested under order.branch / order.restaurant
  const branchName = order.branch?.name || order.restaurantName || "المركزية";
  const branchAddress = order.branch?.address || "السعودية";
  const taxNumber = order.branch?.taxNumber || order.taxNumber || "312345678900003"; // fallback or mock
  const phone = order.branch?.phone || order.phone || "";
  
  const orderId = order.id || order.orderId || "";
  const createdAt = order.createdAt || new Date();
  
  const subtotal = order.subtotal || 0;
  const deliveryFee = order.deliveryFee || 0;
  const tax = order.tax || 0; // if you have explicit tax amount
  const total = order.total || order.totalPrice || 0;
  
  const qrCodeValue = generateZatcaQrCode(
    branchName,
    taxNumber,
    new Date(createdAt).toISOString(),
    total.toString(),
    tax.toString()
  );

  return (
    <div ref={ref} className="invoice-print-wrapper" dir="rtl" style={{
      fontFamily: "'Arial', 'Tahoma', sans-serif",
      width: "74mm",
      margin: "0 auto",
      paddingTop: "5mm",
      fontSize: "12px",
      color: "#000"
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <h2 style={{ fontSize: '16px', margin: '0 0 4px 0' }}>{branchName}</h2>
        <p style={{ margin: '2px 0', fontSize: '11px' }}>{branchAddress}</p>
        {phone && <p style={{ margin: '2px 0', fontSize: '11px' }}>{phone}</p>}
        <p style={{ margin: '2px 0', fontSize: '11px' }}>الرقم الضريبي: {taxNumber}</p>
      </div>

      <hr style={{ borderTop: '1px dashed #000', borderBottom: 'none', margin: '8px 0' }} />

      {/* Order Info */}
      <div style={{ marginBottom: '8px', fontSize: '11px' }}>
        <p style={{ margin: '2px 0' }}>رقم الطلب: {orderId.toString().substring(0, 8)}</p>
        <p style={{ margin: '2px 0' }}>التاريخ: {format(new Date(createdAt), 'yyyy/MM/dd HH:mm')}</p>
        <p style={{ margin: '2px 0' }}>النوع: {order.orderType === 'delivery' ? 'توصيل' : 'استلام'}</p>
        {(order.customerName || order.customer?.name) && (
          <p style={{ margin: '2px 0' }}>العميل: {order.customerName || order.customer?.name}</p>
        )}
      </div>

      <hr style={{ borderTop: '1px dashed #000', borderBottom: 'none', margin: '8px 0' }} />

      {/* Items */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'right', paddingBottom: '4px', borderBottom: '1px solid #000', fontSize: '11px' }}>الصنف</th>
            <th style={{ textAlign: 'center', paddingBottom: '4px', borderBottom: '1px solid #000', fontSize: '11px' }}>الكمية</th>
            <th style={{ textAlign: 'left', paddingBottom: '4px', borderBottom: '1px solid #000', fontSize: '11px' }}>السعر</th>
          </tr>
        </thead>
        <tbody>
          {(order.cartItems || order.orderItems || []).map((item, i) => (
            <React.Fragment key={i}>
              <tr>
                <td style={{ paddingTop: '4px', fontSize: '11px' }}>{item.title || item.name}</td>
                <td style={{ paddingTop: '4px', textAlign: 'center', fontSize: '11px' }}>{item.qty || item.quantity}</td>
                <td style={{ paddingTop: '4px', textAlign: 'left', fontSize: '11px' }}>
                  {formatCurrencyArabic(item.lineTotal || (item.price * (item.qty || 1)))}
                </td>
              </tr>
              {(item.optionsText || (item.modifiers && item.modifiers.length > 0)) && (
                <tr>
                  <td colSpan={3} style={{ paddingRight: '8px', fontSize: '10px', color: '#333' }}>
                    + {item.optionsText || item.modifiers?.join('، ')}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <hr style={{ borderTop: '1px dashed #000', borderBottom: 'none', margin: '8px 0' }} />

      {/* Financials */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
          <span>المجموع الفرعي</span>
          <span>{formatCurrencyArabic(subtotal)}</span>
        </div>
        {deliveryFee > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
            <span>رسوم التوصيل</span>
            <span>{formatCurrencyArabic(deliveryFee)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px', fontWeight: 'bold' }}>
          <span>الإجمالي الكلي (شامل الضريبة)</span>
          <span>{formatCurrencyArabic(total)}</span>
        </div>
      </div>

      <hr style={{ borderTop: '1px dashed #000', borderBottom: 'none', margin: '8px 0' }} />

      {/* QR Code */}
      <div style={{ textAlign: 'center', marginTop: '12px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <QRCodeSVG value={qrCodeValue} size={150} style={{ width: '40mm', height: '40mm' }} />
        </div>
      </div>

      <p style={{ textAlign: 'center', fontSize: '11px', marginTop: '12px', marginBottom: '0' }}>شكراً لزيارتكم</p>
    </div>
  );
});

ThermalInvoiceTemplate.displayName = 'ThermalInvoiceTemplate';
