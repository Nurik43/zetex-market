import { useRef, useState } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../../api';
import { useToast } from '../useToast';
import { t } from '../../i18n';
import { money } from '../../format';
import ProductForm from './ProductForm';

export default function ProductsTab({ products, loading, taxonomy, onChanged }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(null);
  const formRef = useRef(null);

  const edit = (p) => {
    setEditing(p);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const remove = async (p) => {
    if (!window.confirm(t('Удалить товар «{title}»?', { title: p.title }))) return;
    try {
      await api.deleteProduct(p.id);
      if (editing?.id === p.id) setEditing(null);
      toast(t('Товар удалён'));
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <section className="ztx-seller-card" aria-labelledby="plist-h">
        <div className="ztx-seller-card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 id="plist-h" style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{t('Ваши товары')} <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>({products.length})</span></h3>
          <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => { setEditing(null); requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>+ {t('Добавить товар')}</button>
        </div>
        <div className="ztx-seller-table-wrap">
          <table className="ztx-seller-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th scope="col">{t('Товар')}</th>
                <th scope="col">{t('Категория')}</th>
                <th scope="col">{t('Цена')}</th>
                <th scope="col">{t('Остаток')}</th>
                <th scope="col" style={{ textAlign: 'center' }}>{t('Действия')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={editing?.id === p.id ? 'sel' : ''}>
                  <td>
                    <div className="ztx-seller-prod">
                      <img src={imgUrl(p.image)} loading="lazy" alt="" onError={hideBrokenImg} />
                      <div>
                        <a className="ztx-seller-prod-title" href={`/product/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{p.title}</a>
                        {p.status === 'pending' && <div className="ztx-seller-hidden-note">{t('На проверке у модератора — в каталоге появится после одобрения')}</div>}
                        {p.status === 'hidden' && <div className="ztx-seller-hidden-note">{t('Скрыт из каталога модератором')}{p.statusReason ? `: ${p.statusReason}` : ''}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>{t(p.category)}{p.subcategory ? ` · ${t(p.subcategory)}` : ''}</td>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {p.oldPrice ? <span className="ztx-seller-old">{money(p.oldPrice)}</span> : null}
                    {money(p.price)}
                  </td>
                  <td style={{ fontWeight: 600, color: p.stock === 0 ? 'var(--danger)' : p.stock < 10 ? 'var(--warn-ink)' : 'var(--ink)' }}>
                    {p.stock === 0 ? t('Нет в наличии') : t('{n} шт.', { n: p.stock })}
                  </td>
                  <td>
                    <div className="ztx-seller-actions">
                      <button type="button" className="ztx-seller-iconbtn brand" onClick={() => edit(p)} title={t('Редактировать')} aria-label={t('Редактировать товар «{title}»', { title: p.title })}><Edit2 size={18} /></button>
                      <button type="button" className="ztx-seller-iconbtn danger" onClick={() => remove(p)} title={t('Удалить')} aria-label={t('Удалить товар «{title}»', { title: p.title })}><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {products.length === 0 && <div className="ztx-seller-empty">{loading ? t('Загрузка…') : t('У вас пока нет добавленных товаров.')}</div>}
      </section>

      <div ref={formRef} style={{ scrollMarginTop: 16 }}>
        <ProductForm
          key={editing?.id ?? 'new'}
          editing={editing}
          taxonomy={taxonomy}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      </div>
    </>
  );
}
