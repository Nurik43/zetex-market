import { useEffect, useState } from 'react';
import { t } from './i18n';

/**
 * Запрос данных с «живым» кэшем: пока грузится новый ключ, показываются прежние данные.
 * key — строка, меняющаяся при смене параметров; fetcher — функция, возвращающая промис.
 */
export function useQuery(key, fetcher) {
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState({ id: null, data: null, error: '' });
  const id = `${key}#${tick}`;

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((data) => { if (!cancelled) setRes({ id, data, error: '' }); })
      .catch((e) => { if (!cancelled) setRes({ id, data: null, error: e.message || t('Ошибка загрузки') }); });
    return () => { cancelled = true; };
    // fetcher намеренно не в зависимостях: ключ key описывает все параметры запроса
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loading = res.id !== id;
  return { data: res.data, error: loading ? '' : res.error, loading, retry: () => setTick((t) => t + 1) };
}
