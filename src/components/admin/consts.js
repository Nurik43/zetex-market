// [подпись, тон бейджа]; подпись переводится при показе
export const ORDER_STATUS = {
  pending: ['Новый', 'brand'], confirmed: ['Подтверждён', 'brand'], shipped: ['Отправлен', 'warn'],
  delivered: ['Доставлен', 'ok'], cancelled: ['Отменён', 'danger'],
};
export const PAY_STATUS = {
  cod: ['При получении', 'neutral'], pending: ['Ожидает оплаты', 'warn'], paid: ['Оплачен', 'ok'],
  unpaid: ['Не оплачен', 'danger'], refund_pending: ['Ждёт возврата', 'danger'], refunded: ['Возвращён', 'neutral'],
};
