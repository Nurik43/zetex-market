import { config } from './config.js';

/** Какие способы оплаты сейчас доступны (по наличию ключей провайдеров). */
export function availableMethods() {
  const { payme, click, mock } = config.payments;
  return {
    cash: true,
    payme: !!(payme.merchantId && payme.key),
    click: !!(click.serviceId && click.merchantId && click.secretKey),
    mock,
  };
}
