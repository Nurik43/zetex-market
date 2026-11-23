import { getSetting } from './settings.js';

// Параметры доставки. ВНИМАНИЕ: пункты выдачи ниже — пример для демо, замените на свои реальные адреса.
export const CITIES = [
  'Ташкент', 'Самарканд', 'Бухара', 'Андижан', 'Наманган', 'Фергана', 'Нукус',
  'Карши', 'Ургенч', 'Термез', 'Джизак', 'Гулистан', 'Навои',
];

const DEMO_POINTS = [
  { id: 'tash-1', city: 'Ташкент', name: 'Пункт выдачи Zetex (пример 1)', address: 'г. Ташкент, ул. Примерная, 1' },
  { id: 'tash-2', city: 'Ташкент', name: 'Пункт выдачи Zetex (пример 2)', address: 'г. Ташкент, пр. Примерный, 25' },
  { id: 'sam-1', city: 'Самарканд', name: 'Пункт выдачи Zetex (пример)', address: 'г. Самарканд, ул. Примерная, 10' },
];

// Свои пункты выдачи: PICKUP_POINTS='[{"id":"tash-1","city":"Ташкент","name":"…","address":"…"}]'
function loadPoints() {
  if (!process.env.PICKUP_POINTS) return DEMO_POINTS;
  try {
    const list = JSON.parse(process.env.PICKUP_POINTS);
    const ok = Array.isArray(list) && list.every((p) => p && p.id && p.city && p.name && p.address && CITIES.includes(p.city));
    if (ok) return list.map(({ id, city, name, address }) => ({ id: String(id), city, name, address }));
    console.warn('PICKUP_POINTS: нужен массив объектов {id, city, name, address}, город — из списка CITIES; используются демо-пункты');
  } catch { console.warn('PICKUP_POINTS: некорректный JSON; используются демо-пункты'); }
  return DEMO_POINTS;
}
const ENV_POINTS = loadPoints();

const ENV_FEE = Number(process.env.DELIVERY_FEE) || 25000;
const ENV_FREE_FROM = Number(process.env.FREE_DELIVERY_FROM) || 500000;

// Значения из админки (таблица settings) перекрывают переменные окружения
export const getPickupPoints = () => getSetting('pickup_points', ENV_POINTS);
export const getDeliveryFee = () => Number(getSetting('delivery_fee', ENV_FEE));
export const getFreeFrom = () => Number(getSetting('free_delivery_from', ENV_FREE_FROM));

export const deliveryFee = (method, goodsTotal) =>
  method === 'pickup' || goodsTotal >= getFreeFrom() ? 0 : getDeliveryFee();
