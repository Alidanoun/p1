export const generateZatcaQrCode = (sellerName, taxNumber, timestamp, invoiceTotal, vatTotal) => {
  const encoder = new TextEncoder();

  const getTagBytes = (tag, value) => {
    const valueBytes = encoder.encode(String(value));
    const tagBytes = new Uint8Array([tag]);
    const lengthBytes = new Uint8Array([valueBytes.length]);
    const result = new Uint8Array(tagBytes.length + lengthBytes.length + valueBytes.length);
    result.set(tagBytes, 0);
    result.set(lengthBytes, tagBytes.length);
    result.set(valueBytes, tagBytes.length + lengthBytes.length);
    return result;
  };

  const sellerNameBytes = getTagBytes(1, sellerName);
  const taxNumberBytes = getTagBytes(2, taxNumber);
  const timestampBytes = getTagBytes(3, timestamp);
  const invoiceTotalBytes = getTagBytes(4, invoiceTotal);
  const vatTotalBytes = getTagBytes(5, vatTotal);

  const totalLength = sellerNameBytes.length + taxNumberBytes.length + timestampBytes.length + invoiceTotalBytes.length + vatTotalBytes.length;
  const finalBytes = new Uint8Array(totalLength);

  let offset = 0;
  finalBytes.set(sellerNameBytes, offset); offset += sellerNameBytes.length;
  finalBytes.set(taxNumberBytes, offset); offset += taxNumberBytes.length;
  finalBytes.set(timestampBytes, offset); offset += timestampBytes.length;
  finalBytes.set(invoiceTotalBytes, offset); offset += invoiceTotalBytes.length;
  finalBytes.set(vatTotalBytes, offset);

  return btoa(String.fromCharCode.apply(null, finalBytes));
};
