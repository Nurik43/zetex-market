import { useEffect, useState } from 'react';
import { ShoppingBag, Heart, User, Menu, X, ChevronRight, LogOut, LayoutGrid, Scale, Moon, Sun, ShieldCheck, MessageCircle } from 'lucide-react';
import { api } from '../api';
import { navigate, catalogUrl } from '../router';
import { iconFor } from '../icons';
import { compareList } from '../localStore';
import { t, getLang, setLang } from '../i18n';
import { useTheme, setTheme } from '../theme';
import SearchBox from './SearchBox';

export default function Header({
  route, taxonomy, totalItems, totalFavorites, onOpenCart, onOpenFavorites,
  user, onOpenAuth, onLogout, onOpenOrders,
}) {
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(null);

  const compareCount = compareList.use().length;

  // Непрочитанные сообщения (покупатель и продавец): опрос раз в 30 секунд и сразу после чтения переписки
  const canChat = user?.role === 'buyer' || user?.role === 'seller';
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!canChat) { setUnread(0); return undefined; }
    let off = false;
    const load = () => api.chatsUnread().then((d) => { if (!off) setUnread(d.count); }).catch(() => {});
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    window.addEventListener('ztx:unread', load);
    return () => { off = true; clearInterval(timer); window.removeEventListener('ztx:unread', load); };
  }, [canChat, user?.id, route.path]);
  const theme = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (!isCatalogOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setIsCatalogOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCatalogOpen]);

  const currentCat = route.name === 'catalog' ? route.params.category || '' : null;
  const openTab = activeTab || taxonomy[0]?.name;
  const active = taxonomy.find((c) => c.name === openTab);
  const go = (path) => { setIsCatalogOpen(false); navigate(path); };

  const isStaff = user?.role === 'seller' || user?.role === 'admin';

  return (
    <header className="ztx-header" data-staff={isStaff ? user.role : undefined}>
      <div className="ztx-header-row">
        <button className="ztx-logo" onClick={() => go('/')} aria-label={t('zetex.market — на главную')}>
          zetex<span>.market</span>
        </button>

        {isStaff && <span className="ztx-staff-badge">{user.role === 'admin' ? t('Администрирование') : t('Кабинет продавца')}</span>}

        {!isStaff && <button className="ztx-catalog-btn" aria-label={t("Каталог")} onClick={() => setIsCatalogOpen(!isCatalogOpen)} aria-expanded={isCatalogOpen}>
          <span className={`ztx-burger ${isCatalogOpen ? 'open' : ''}`}>{isCatalogOpen ? <X size={18} /> : <Menu size={18} />}</span>
          <span aria-hidden="false">{t('Каталог')}</span>
        </button>}

        {isStaff ? <div style={{ flex: 1 }} /> : <SearchBox route={route} onNavigate={() => setIsCatalogOpen(false)} />}

        <div className="ztx-prefs">
          <button type="button" className="ztx-pref-btn" onClick={() => setLang(getLang() === 'ru' ? 'uz' : 'ru')} aria-label={t('Язык интерфейса')} title={t('Язык интерфейса')}>
            {getLang() === 'ru' ? 'UZ' : 'RU'}
          </button>
          <button type="button" className="ztx-pref-btn" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label={isDark ? t('Светлая тема') : t('Тёмная тема')} title={isDark ? t('Светлая тема') : t('Тёмная тема')}>
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>

        <nav className="ztx-nav">
          {user ? (
            <>
              <button className="ztx-nav-btn" aria-label={user.role === 'buyer' ? t('Мои заказы и профиль') : user.role === 'admin' ? t('Администрирование') : t('Панель продавца')} onClick={() => { if (user.role !== 'seller') onOpenOrders(); }} title={user.role === 'buyer' ? t('Мои заказы и профиль') : user.role === 'admin' ? t('Администрирование') : t('Панель продавца')} style={{ color: 'var(--brand)' }}>
                {user.role === 'admin' ? <ShieldCheck size={22} /> : <User size={22} />}
                <span className="ztx-nav-label" style={{ fontWeight: 600 }}>{user.firstName || t('Профиль')}</span>
              </button>
              <button className="ztx-nav-btn" onClick={onLogout} aria-label={t('Выйти из аккаунта')}>
                <LogOut size={22} />
                <span className="ztx-nav-label">{t('Выйти')}</span>
              </button>
            </>
          ) : (
            <button className="ztx-nav-btn" onClick={onOpenAuth} aria-label={t('Войти')}>
              <User size={22} />
              <span className="ztx-nav-label">{t('Войти')}</span>
            </button>
          )}

          {canChat && (
            <button className="ztx-nav-btn" onClick={() => go('/chats')} aria-label={unread ? t('Сообщения, непрочитанных: {n}', { n: unread }) : t('Сообщения')}>
              <MessageCircle size={22} />
              <span className="ztx-nav-label">{t('Сообщения')}</span>
              {unread > 0 && <span key={unread} className="ztx-badge ztx-pop">{unread > 99 ? '99+' : unread}</span>}
            </button>
          )}

          {user?.role !== 'seller' && user?.role !== 'admin' && (
            <button className="ztx-nav-btn" onClick={() => go('/compare')} aria-label={t('Сравнение')}>
              <Scale size={22} />
              <span className="ztx-nav-label">{t('Сравнение')}</span>
              {compareCount > 0 && <span key={compareCount} className="ztx-badge ztx-pop">{compareCount}</span>}
            </button>
          )}

          {/* Избранное — гостям и покупателям; корзина — только вошедшему покупателю */}
          {user?.role !== 'seller' && user?.role !== 'admin' && (
            <button className="ztx-nav-btn" onClick={onOpenFavorites} aria-label={t('Избранное')}>
              <Heart size={22} color={totalFavorites > 0 ? 'var(--danger)' : 'currentColor'} fill={totalFavorites > 0 ? 'var(--danger)' : 'none'} />
              <span className="ztx-nav-label">{t('Избранное')}</span>
              {totalFavorites > 0 && <span key={totalFavorites} className="ztx-badge fav ztx-pop">{totalFavorites}</span>}
            </button>
          )}

          {user?.role === 'buyer' && (
            <button className="ztx-nav-btn" onClick={onOpenCart} aria-label={t('Корзина')} data-cart-target>
              <ShoppingBag size={22} />
              <span className="ztx-nav-label">{t('Корзина')}</span>
              {totalItems > 0 && <span key={totalItems} className="ztx-badge ztx-pop">{totalItems}</span>}
            </button>
          )}
        </nav>
      </div>

      {!isStaff && <div className="ztx-catstrip">
        <div className="ztx-catstrip-inner">
          <button className="ztx-cat" aria-current={currentCat === ''} onClick={() => go('/catalog')}>
            <LayoutGrid size={17} /> {t('Все товары')}
          </button>
          {taxonomy.map((cat) => {
            const Icon = iconFor(cat.icon);
            return (
              <button key={cat.name} className="ztx-cat" aria-current={currentCat === cat.name} onClick={() => go(catalogUrl({ category: cat.name }))}>
                <Icon size={17} /> {t(cat.name)}
              </button>
            );
          })}
        </div>
      </div>}

      {!isStaff && isCatalogOpen && active && (
        <>
          <div className="ztx-mega-scrim" onClick={() => setIsCatalogOpen(false)} />
          <div className="ztx-mega" role="menu">
            <div className="ztx-mega-inner">
              <div className="ztx-mega-left">
                {taxonomy.map((cat) => {
                  const Icon = iconFor(cat.icon);
                  return (
                    <button
                      key={cat.name}
                      role="menuitem"
                      className="ztx-mega-cat"
                      aria-current={openTab === cat.name}
                      onMouseEnter={() => setActiveTab(cat.name)}
                      onFocus={() => setActiveTab(cat.name)}
                      onClick={() => go(catalogUrl({ category: cat.name }))}
                    >
                      <span><Icon size={18} />{t(cat.name)}</span>
                      <ChevronRight size={14} />
                    </button>
                  );
                })}
              </div>
              <div className="ztx-mega-right" key={active.name}>
                <div className="ztx-mega-title">
                  <h3>{t(active.name)}</h3>
                  <button className="ztx-link" onClick={() => go(catalogUrl({ category: active.name }))}>{t('Все товары категории')}</button>
                </div>
                <div className="ztx-mega-groups">
                  {active.groups.map((g) => (
                    <div key={g.name} className="ztx-mega-group">
                      <h4>{t(g.name)}</h4>
                      {g.items.map((sub) => (
                        <button key={sub} role="menuitem" onClick={() => go(catalogUrl({ category: active.name, subcategory: sub }))}>{t(sub)}</button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
