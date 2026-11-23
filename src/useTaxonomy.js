import { useQuery } from './useQuery';
import { api } from './api';

let cache = null;

/** Дерево каталога с сервера: [{ name, icon, groups: [{ name, items: [] }] }] */
export function useTaxonomy() {
  const { data } = useQuery('taxonomy', async () => {
    if (!cache) cache = (await api.categories()).tree;
    return cache;
  });
  return data || cache || [];
}
