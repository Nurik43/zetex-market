import { useEffect, useState } from 'react';
import { useQuery } from '../../useQuery';

/** Значение с задержкой — для поиска по мере ввода. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Постраничный список: параметры → запрос; ключ кэша строится из параметров. */
export function useList(fetcher, params) {
  return useQuery(JSON.stringify(params), () => fetcher(params));
}

/** Выбор строк для массовых действий. */
export function useSelection() {
  const [ids, setIds] = useState([]);
  return {
    ids, count: ids.length,
    has: (id) => ids.includes(id),
    toggle: (id) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    setAll: (list, on) => setIds(on ? list : []),
    clear: () => setIds([]),
  };
}

