import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

/**
 * useMutation hook لتحديث حالة الطلب مع Optimistic UI كامل.
 * 
 * دورة الحياة:
 *  1. onMutate  → snapshot الـ cache + تطبيق التغيير المؤقت فوراً
 *  2. mutationFn → إرسال PATCH للـ API
 *  3. onError   → rollback إلى الـ snapshot
 *  4. onSettled → invalidate الـ cache مهما كانت النتيجة
 */
export const useUpdateOrderStatus = (branchId) => {
  const queryClient = useQueryClient();
  const queryKey = ['orders', branchId];

  return useMutation({
    /**
     * ⚡ Optimistic Update
     * يُطبَّق فوراً قبل وصول رد الـ API.
     * يُعيد snapshot للـ rollback في حال الفشل.
     */
    onMutate: async ({ orderId, newStatus }) => {
      // 1. إلغاء أي refetch جارٍ لمنع تلوث الـ snapshot
      await queryClient.cancelQueries({ queryKey });

      // 2. حفظ الحالة الحالية للـ rollback
      const previousOrders = queryClient.getQueryData(queryKey);

      // 3. تطبيق التغيير مؤقتاً في الـ cache
      queryClient.setQueryData(queryKey, (oldOrders = []) =>
        oldOrders.map((order) =>
          order.id === orderId
            ? { ...order, status: newStatus, _optimistic: true }
            : order
        )
      );

      // إرجاع الـ snapshot — يُمرَّر تلقائياً إلى onError
      return { previousOrders };
    },

    mutationFn: async ({ orderId, newStatus, version }) => {
      const idempotencyKey = generateUUID();
      const { data } = await api.patch(
        `/orders/${orderId}/status`,
        { status: newStatus, version },
        { headers: { 'idempotency-key': idempotencyKey } }
      );
      return data;
    },

    /**
     * 🔄 Rollback
     * يُستدعى فقط عند الفشل. يُعيد الـ cache لحالته قبل onMutate.
     */
    onError: (_error, _variables, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(queryKey, context.previousOrders);
      }
    },

    /**
     * 🔃 Final Sync
     * يُستدعى دائماً (نجاح أو فشل). يضمن مزامنة الـ cache مع الـ backend.
     * نُؤخّر قليلاً لمنع flash عند الـ Socket event الذي يأتي بعد 200ms.
     */
    onSettled: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ['branchStats', branchId] });
      }, 300);
    },
  });
};
