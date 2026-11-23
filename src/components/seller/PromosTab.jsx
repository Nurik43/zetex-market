import { useCallback, useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../useToast';
import { t, fmtDate } from '../../i18n';
import { money, num } from '../../format';

const EMPTY = { code: '', type: 'percent', value: '10', minTotal: '', maxUses: '', expiresAt: '' };

export default function PromosTab() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await api.myPromos()).items); } catch (e) { toast(e.message, 'error'); } finally { setLoading(false); }
  }, [toast]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.createPromo({
        code: form.code.trim(), type: form.type, value: Number(form.value),
        minTotal: form.minTotal ? Number(form.minTotal) : 0,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        expiresAt: form.expiresAt || null, active: true,
      });
      toast(t('Промокод создан'));
      setForm(EMPTY);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (p) => {
    try { await api.updatePromo(p.id, { active: !p.active }); load(); } catch (err) { toast(err.message, 'error'); }
  };
  const remove = async (p) => {
    if (!window.confirm(t('Удалить промокод {code}?', { code: p.code }))) return;
    try { await api.deletePromo(p.id); toast(t('Промокод удалён')); load(); } catch (err) { toast(err.message, 'error'); }
  };

  const [now] = useState(() => Date.now());
  const expired = (p) => p.expiresAt && Date.parse(p.expiresAt.replace(' ', 'T') + 'Z') < now;

  return (
    <>
      <section className="ztx-seller-card" aria-labelledby="promo-new">
        <div className="ztx-seller-card-head"><h3 id="promo-new" style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{t('Новый промокод')}</h3></div>
        <form className="ztx-seller-card-pad ztx-seller-col" onSubmit={create}>
          <p className="ztx-seller-note">{t('Промокод действует только на ваши товары.')}</p>
          <div className="ztx-seller-row" style={{ alignItems: 'flex-start' }}>
            <div className="ztx-seller-field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="pr-code">{t('Код')}</label>
              <input id="pr-code" className="ztx-seller-input" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_\-]{3,20}" placeholder="SALE10" value={form.code} onChange={set('code')} style={{ textTransform: 'uppercase' }} aria-describedby="pr-code-h" />
              <p id="pr-code-h" className="ztx-seller-hint">{t('3–20 символов: латиница, цифры, - и _')}</p>
            </div>
            <div className="ztx-seller-field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="pr-type">{t('Тип скидки')}</label>
              <select id="pr-type" className="ztx-seller-input" value={form.type} onChange={set('type')}>
                <option value="percent">{t('Процент')}</option>
                <option value="fixed">{t('Фиксированная сумма')}</option>
              </select>
            </div>
            <div className="ztx-seller-field" style={{ flex: '1 1 120px' }}>
              <label htmlFor="pr-val">{form.type === 'percent' ? t('Скидка, % (до 90)') : t('Скидка, сум')}</label>
              <input id="pr-val" type="number" required min="1" max={form.type === 'percent' ? 90 : undefined} className="ztx-seller-input" value={form.value} onChange={set('value')} />
            </div>
          </div>
          <div className="ztx-seller-row" style={{ alignItems: 'flex-start' }}>
            <div className="ztx-seller-field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="pr-min">{t('Минимальная сумма заказа')}</label>
              <input id="pr-min" type="number" min="0" className="ztx-seller-input" placeholder="0" value={form.minTotal} onChange={set('minTotal')} />
            </div>
            <div className="ztx-seller-field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="pr-max">{t('Лимит применений')}</label>
              <input id="pr-max" type="number" min="1" className="ztx-seller-input" placeholder={t('Без лимита')} value={form.maxUses} onChange={set('maxUses')} />
            </div>
            <div className="ztx-seller-field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="pr-exp">{t('Действует до')}</label>
              <input id="pr-exp" type="date" className="ztx-seller-input" value={form.expiresAt} onChange={set('expiresAt')} />
            </div>
          </div>
          <div>
            <button type="submit" className="ztx-seller-btn primary big" disabled={saving}><Plus size={16} aria-hidden="true" /> {saving ? t('Создаём…') : t('Создать промокод')}</button>
          </div>
        </form>
      </section>

      <section className="ztx-seller-card" aria-labelledby="promo-list">
        <div className="ztx-seller-card-head"><h3 id="promo-list" style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{t('Ваши промокоды')}</h3></div>
        {items.length === 0 ? (
          <div className="ztx-seller-empty">{loading ? t('Загрузка…') : t('Промокодов пока нет.')}</div>
        ) : (
          <div className="ztx-seller-table-wrap">
            <table className="ztx-seller-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th scope="col">{t('Код')}</th><th scope="col">{t('Скидка')}</th><th scope="col">{t('От суммы')}</th>
                  <th scope="col">{t('Применений')}</th><th scope="col">{t('Срок')}</th><th scope="col">{t('Статус')}</th><th scope="col"><span className="ztx-seller-sr">{t('Действия')}</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{p.code}</td>
                    <td>{p.type === 'percent' ? `${p.value}%` : money(p.value)}</td>
                    <td>{p.minTotal ? money(p.minTotal) : '—'}</td>
                    <td>{num(p.usedCount)}{p.maxUses ? ` / ${num(p.maxUses)}` : ''}</td>
                    <td>{p.expiresAt ? fmtDate(p.expiresAt) : '—'}</td>
                    <td>
                      {expired(p)
                        ? <span className="ztx-seller-badge danger">{t('Истёк')}</span>
                        : <span className={`ztx-seller-badge ${p.active ? 'accent' : ''}`}>{p.active ? t('Активен') : t('Выключен')}</span>}
                    </td>
                    <td>
                      <div className="ztx-seller-actions">
                        <button type="button" className="ztx-seller-btn" onClick={() => toggle(p)} aria-label={`${p.active ? t('Выключить') : t('Включить')} ${p.code}`}>{p.active ? t('Выключить') : t('Включить')}</button>
                        <button type="button" className="ztx-seller-iconbtn danger" onClick={() => remove(p)} aria-label={t('Удалить промокод {code}', { code: p.code })}><Trash2 size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
