import { useEffect, useId, useRef, useState } from 'react';
import { Search, Clock, Folder } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../api';
import { navigate, catalogUrl } from '../router';
import { recentlyViewed } from '../localStore';
import { t } from '../i18n';
import { money } from '../format';

// Поиск с подсказками: категории и товары по мере ввода; в пустом поле — «Вы смотрели»
export default function SearchBox({ route, onNavigate }) {
  const routeQ = route.name === 'catalog' ? route.params.q || '' : '';
  const [text, setText] = useState(routeQ);
  const [prevRouteQ, setPrevRouteQ] = useState(routeQ);
  if (routeQ !== prevRouteQ) { setPrevRouteQ(routeQ); if (routeQ !== text) setText(routeQ); }

  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [res, setRes] = useState({ q: '', products: [], sections: [] });
  const [recent, setRecent] = useState([]);
  const timer = useRef(null);
  const wrap = useRef(null);
  const listId = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  // клик/фокус вне поля закрывает список
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const q = text.trim();
  const searching = q.length >= 2;
  const fresh = res.q === q;
  const showRecent = open && !q && recent.length > 0;

  const loadRecent = () => {
    const ids = recentlyViewed.get().slice(0, 5);
    if (!ids.length) { setRecent([]); return; }
    api.products({ ids: ids.join(','), limit: 10 }).then((d) => {
      const by = new Map(d.items.map((p) => [p.id, p]));
      setRecent(ids.map((id) => by.get(id)).filter(Boolean));
    }).catch(() => {});
  };

  const submit = (value) => {
    const query = value.trim();
    const sort = route.name === 'catalog' ? route.params.sort : '';
    if (route.name === 'catalog') navigate(catalogUrl({ q: query, sort }), { replace: true });
    else if (query) navigate(catalogUrl({ q: query }));
  };

  const onType = (e) => {
    const v = e.target.value;
    setText(v);
    setHi(-1);
    setOpen(true);
    onNavigate?.();
    clearTimeout(timer.current);
    const vq = v.trim();
    timer.current = setTimeout(() => {
      submit(v);
      if (vq.length >= 2) {
        api.suggest(vq).then((d) => setRes({ q: vq, products: d.products, sections: d.sections })).catch(() => {});
      }
    }, 300);
  };

  // единый список вариантов для навигации стрелками
  const options = [];
  if (showRecent) recent.forEach((p) => options.push({ type: 'product', p }));
  if (open && searching && fresh) {
    res.sections.forEach((s) => options.push({ type: 'section', s }));
    res.products.forEach((p) => options.push({ type: 'product', p }));
  }
  const go = (o) => {
    setOpen(false);
    clearTimeout(timer.current);
    if (o.type === 'product') navigate(`/product/${o.p.id}`);
    else navigate(catalogUrl({ category: o.s.category, subcategory: o.s.subcategory }));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h <= 0 ? options.length - 1 : h - 1)); }
    else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); go(options[hi]); }
  };

  const expanded = open && options.length > 0;
  let idx = -1;

  return (
    <div className="ztx-search-wrap" ref={wrap}>
      <form className="ztx-header-search" role="search" onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); setOpen(false); submit(text); }}>
        <input
          type="search" placeholder={t('Найти товар или категорию')} aria-label={t('Поиск')} autoComplete="off"
          role="combobox" aria-expanded={expanded} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={hi >= 0 ? `${listId}-${hi}` : undefined}
          value={text} onChange={onType} onKeyDown={onKeyDown}
          onFocus={() => { setOpen(true); if (!text.trim()) loadRecent(); }}
        />
        <Search size={20} color="var(--ink-3)" />
      </form>

      {expanded && (
        <ul className="ztx-suggest" id={listId} role="listbox" aria-label={t('Подсказки')}>
          {showRecent && <li className="ztx-suggest-head" role="presentation">{t('Вы смотрели')}</li>}
          {options.map((o, i) => {
            idx = i;
            const key = o.type === 'product' ? `p${o.p.id}` : `s${o.s.category}${o.s.subcategory}`;
            return (
              <li key={key} id={`${listId}-${idx}`} role="option" aria-selected={hi === i} className={`ztx-suggest-item ${hi === i ? 'hi' : ''}`}
                onPointerDown={(e) => e.preventDefault()} onClick={() => go(o)} onMouseEnter={() => setHi(i)}>
                {o.type === 'product' ? (
                  <>
                    <img src={imgUrl(o.p.image)} alt="" onError={hideBrokenImg} />
                    <span className="ztx-suggest-title">{o.p.title}</span>
                    <b>{money(o.p.price)}</b>
                  </>
                ) : (
                  <>
                    <span className="ztx-suggest-ico">{showRecent ? <Clock size={16} /> : <Folder size={16} />}</span>
                    <span className="ztx-suggest-title">{o.s.subcategory ? `${t(o.s.subcategory)} · ${t(o.s.category)}` : t(o.s.category)}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
