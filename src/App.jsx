import { useState, useEffect, useCallback, useRef } from 'react';
import { api, imgUrl } from './api';
import { t, useLang } from './i18n';
import './theme';
import { useToast } from './components/useToast';
import { useRoute, navigate } from './router';
import { useTaxonomy } from './useTaxonomy';
import { flyToCart } from './flyToCart';
import Header from './components/Header';
import Announcement from './components/Announcement';
import CartModal from './components/CartModal';
import Home from './pages/Home';
import Catalog from './pages/Catalog';
import Favorites from './pages/Favorites';
import SellerDashboard from './components/SellerDashboard';
import AuthModal from './components/AuthModal';
import Footer from './components/Footer';
import OrdersList from './components/OrdersList';
import Product from './pages/Product';
import Checkout from './pages/Checkout';
import Pay from './pages/Pay';
import Compare from './pages/Compare';
import { ResetPassword, VerifyEmail } from './pages/AuthLinks';
import Legal from './pages/Legal';
import Chats from './pages/Chats';
import { LEGAL_PAGES, LEGAL_TITLES } from './legal/content';
import AdminDashboard from './components/admin/AdminDashboard';

export default function App() {
  useLang();
  const { toast } = useToast();
  const route = useRoute();
  const taxonomy = useTaxonomy();

  // Авторизация: сессия в httpOnly-cookie, пользователь подтягивается с сервера
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  // Корзина лежит на сервере (у вошедшего покупателя), поэтому одинакова на всех его устройствах
  const [cart, setCart] = useState([]);
  const cartSeq = useRef(0); // номер последнего запроса: ответы, пришедшие не по порядку, игнорируем
  const [favorites, setFavorites] = useState([]);
  const [orders, setOrders] = useState([]);

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    api.me()
      .then(({ user: u }) => setUser(u))
      .catch(() => {})
      .finally(() => setAuthReady(true));
  }, []);

  const refreshCart = useCallback(() => {
    const seq = ++cartSeq.current;
    return api.cart().then((d) => { if (seq === cartSeq.current) setCart(d.items); }).catch(() => {});
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user?.role === 'buyer') refreshCart(); else setCart([]);
    try { localStorage.removeItem('ztx_cart'); } catch { /* старая корзина браузера больше не используется */ }
  }, [user?.id, user?.role, refreshCart]);

  // Заголовок вкладки для разделов без своего (страница товара ставит свой сама)
  useEffect(() => {
    if (route.name === 'product') return;
    const name = LEGAL_PAGES.includes(route.name) ? t(LEGAL_TITLES[route.name]) : route.name === 'catalog' ? t('Каталог') : route.name === 'chats' ? t('Сообщения') : '';
    document.title = name ? `${name} — Zetex Market` : t('zetex.market — маркетплейс');
  }, [route.name]);

  // При смене раздела — наверх страницы (внутри каталога фильтры позицию не сбрасывают)
  useEffect(() => { window.scrollTo({ top: 0 }); }, [route.name]);

  const isSeller = user?.role === 'seller';
  const isAdmin = user?.role === 'admin';

  // Избранное привязано к аккаунту
  useEffect(() => {
    // сброс данных аккаунта при выходе
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!user) { setFavorites([]); setOrders([]); return; }
    api.favorites().then((d) => setFavorites(d.items)).catch(() => {});
  }, [user]);

  const loadOrders = useCallback(() => {
    if (user?.role !== 'buyer') return;
    api.orders().then((d) => setOrders(d.items)).catch((e) => toast(e.message, 'error'));
  }, [user, toast]);

  useEffect(() => {
    if (route.name === 'orders') loadOrders();
  }, [route.name, loadOrders]);

  // --- Авторизация ---
  const handleAuthSuccess = ({ user: u }) => {
    setUser(u);
    setIsAuthOpen(false);
    toast(t('Добро пожаловать, {name}!', { name: u.firstName }));
    if (u.role === 'admin') navigate('/admin');
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* сессия и так истечёт */ }
    setUser(null);
    if (['orders', 'favorites', 'checkout', 'pay', 'admin', 'chats'].includes(route.name)) navigate('/');
  };

  const resendVerification = async () => {
    try { await api.resendVerification(); setResent(true); toast(t('Письмо отправлено')); } catch (e) { toast(e.message, 'error'); }
  };

  const handleUpdateUser = async (patch) => {
    try {
      const { user: u } = await api.updateProfile(patch);
      setUser(u);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // --- Корзина ---
  const addToCart = (product, fromEl) => {
    if (user?.role !== 'buyer') {
      if (!user) { toast(t('Войдите или зарегистрируйтесь, чтобы добавить товар в корзину'), 'info'); setIsAuthOpen(true); }
      return;
    }
    if (product.stock === 0) { toast(t('Товара нет в наличии'), 'error'); return; }
    const inCart = cart.find((i) => i.id === product.id);
    if (inCart && product.stock != null && inCart.count >= product.stock) {
      toast(t('В наличии только {n} шт.', { n: product.stock }), 'error');
      return;
    }
    flyToCart(fromEl, imgUrl(product.image));
    setCartQty(product.id, (inCart?.count || 0) + 1, () => toast(t('Добавлено в корзину')), product);
  };

  // Меняем количество сразу на экране, а на сервере сохраняем; при отказе (например, нет остатка) возвращаем как на сервере
  const setCartQty = (id, qty, onOk, product) => {
    const seq = ++cartSeq.current;
    setCart((prev) => {
      if (qty <= 0) return prev.filter((i) => i.id !== id);
      if (prev.some((i) => i.id === id)) return prev.map((i) => (i.id === id ? { ...i, count: qty } : i));
      return product ? [{ id, title: product.title, price: product.price, image: product.image, stock: product.stock, count: qty }, ...prev] : prev;
    });
    api.setCartQty(id, qty)
      .then((d) => { if (seq === cartSeq.current) setCart(d.items); onOk?.(); })
      .catch((e) => { toast(e.message, 'error'); refreshCart(); });
  };

  const removeFromCart = (id) => setCartQty(id, 0);

  const updateCartCount = (id, newCount) => {
    if (newCount <= 0) return removeFromCart(id);
    const item = cart.find((i) => i.id === id);
    const max = item?.stock ?? Infinity;
    if (newCount > max) { toast(t('В наличии только {n} шт.', { n: max }), 'error'); return; }
    setCartQty(id, newCount);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setIsCartOpen(false);
    navigate('/checkout');
  };

  const handleOrderPlaced = () => { refreshCart(); loadOrders(); };

  const handleCancelOrder = async (id) => {
    try {
      await api.cancelOrder(id);
      toast(t('Заказ отменён'));
      loadOrders();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // --- Избранное ---
  const toggleFavorite = async (product) => {
    if (!user) {
      toast(t('Войдите, чтобы сохранять избранное'), 'info');
      setIsAuthOpen(true);
      return;
    }
    const isFav = favorites.some((f) => f.id === product.id);
    // Оптимистично обновляем, при ошибке откатываем
    setFavorites((prev) => (isFav ? prev.filter((f) => f.id !== product.id) : [product, ...prev]));
    try {
      await (isFav ? api.removeFavorite(product.id) : api.addFavorite(product.id));
    } catch (e) {
      setFavorites((prev) => (isFav ? [product, ...prev] : prev.filter((f) => f.id !== product.id)));
      toast(e.message, 'error');
    }
  };

  const openProduct = (p) => navigate(`/product/${p.id}`);
  const openOrderedProduct = (item) => navigate(`/product/${item.productId}`);

  const totalPrice = cart.reduce((sum, i) => sum + i.price * i.count, 0);
  const totalItemsInCart = cart.reduce((n, i) => n + i.count, 0);

  if (!authReady) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>{t('Загрузка…')}</div>;
  }

  const cardHandlers = { favorites, onAddToCart: addToCart, onToggleFavorite: toggleFavorite, onOpenDetail: openProduct };

  const openAuth = () => setIsAuthOpen(true);
  const needLogin = (text) => <LoginRequired text={text} onOpenAuth={openAuth} />;

  let page;
  let wide = false; // страницы-кабинеты без ограничения ширины
  if (route.name === 'reset-password') {
    page = <ResetPassword token={route.params.token || ''} onOpenAuth={openAuth} />;
  } else if (route.name === 'verify-email') {
    page = <VerifyEmail token={route.params.token || ''} onOpenAuth={openAuth} onVerified={() => api.me().then(({ user: u }) => setUser(u)).catch(() => {})} />;
  } else if (LEGAL_PAGES.includes(route.name)) {
    page = <Legal slug={route.name} />;
  } else if (isAdmin) {
    page = <AdminDashboard user={user} onUserChanged={() => api.me().then(({ user: u }) => setUser(u)).catch(() => {})} />;
    wide = true;
  } else if (isSeller && route.name !== 'product' && route.name !== 'chats') {
    page = <SellerDashboard user={user} taxonomy={taxonomy} onUserChanged={() => api.me().then(({ user: u }) => setUser(u)).catch(() => {})} />;
    wide = true;
  } else if (route.name === 'product') {
    page = <Product key={route.id} id={route.id} user={user} favorites={favorites} onAddToCart={addToCart} onToggleFavorite={toggleFavorite} onOpenAuth={openAuth} />;
  } else if (route.name === 'chats') {
    page = user ? <Chats id={route.id} /> : needLogin(t('Войдите, чтобы увидеть сообщения'));
  } else if (route.name === 'checkout') {
    page = <Checkout cart={cart} user={user} onOpenAuth={openAuth} onUpdateCount={updateCartCount} onRemove={removeFromCart} onOrderPlaced={handleOrderPlaced} />;
  } else if (route.name === 'pay') {
    page = user ? <Pay id={route.id} user={user} onPaid={loadOrders} /> : needLogin(t('Войдите, чтобы оплатить заказ'));
  } else if (route.name === 'compare') {
    page = <Compare onAddToCart={addToCart} />;
  } else if (route.name === 'catalog') {
    page = <Catalog params={route.params} taxonomy={taxonomy} {...cardHandlers} />;
  } else if (route.name === 'favorites') {
    page = user ? <Favorites {...cardHandlers} /> : needLogin(t('Войдите, чтобы увидеть избранное'));
  } else if (route.name === 'orders') {
    page = user ? (
      <OrdersList
        orders={orders}
        user={user}
        onProductClick={openOrderedProduct}
        setActiveTab={(tab) => { if (tab === 'home') navigate('/catalog'); }}
        onUpdateUser={handleUpdateUser}
        onCancelOrder={handleCancelOrder}
        onLogout={handleLogout}
        onUserChanged={(u) => setUser(u)}
      />
    ) : needLogin(t('Войдите, чтобы увидеть заказы'));
    wide = true;
  } else if (route.name !== 'home') {
    page = (
      <div className="ztx-empty">
        <h3>{t('Страница не найдена')}</h3>
        <button className="ztx-btn ztx-btn-solid" onClick={() => navigate('/')}>{t('На главную')}</button>
      </div>
    );
  } else {
    page = <Home taxonomy={taxonomy} user={user} onOpenAuth={openAuth} {...cardHandlers} />;
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', margin: 0, padding: 0 }}>
      <Announcement />
      <Header
        route={route}
        taxonomy={taxonomy}
        totalItems={totalItemsInCart}
        totalFavorites={favorites.length}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenFavorites={() => (user ? navigate('/favorites') : (toast(t('Войдите, чтобы увидеть избранное'), 'info'), setIsAuthOpen(true)))}
        user={user}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        onOpenOrders={() => (user ? navigate(isAdmin ? '/admin' : '/orders') : setIsAuthOpen(true))}
      />

      {user && !user.emailVerified && user.role !== 'admin' && (
        <div className="ztx-verify-banner" role="status">
          <span>{t('Подтвердите почту {email} — мы отправили письмо со ссылкой.', { email: user.email })}</span>
          <button type="button" onClick={resendVerification} disabled={resent}>{resent ? t('Письмо отправлено') : t('Отправить ещё раз')}</button>
        </div>
      )}

      {wide ? (
        <div key={route.name} className="ztx-page">{page}</div>
      ) : (
        <main key={route.name} className="ztx-page ztx-main">{page}</main>
      )}

      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} onAuthSuccess={handleAuthSuccess} />

      <CartModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        onRemove={removeFromCart}
        onUpdateCount={updateCartCount}
        totalPrice={totalPrice}
        onCheckout={handleCheckout}
              />

      <Footer onOpenAuth={() => setIsAuthOpen(true)} />
    </div>
  );
}

function LoginRequired({ text, onOpenAuth }) {
  return (
    <div className="ztx-empty">
      <h3>{text}</h3>
      <button className="ztx-btn ztx-btn-solid" onClick={onOpenAuth}>{t('Войти или создать аккаунт')}</button>
    </div>
  );
}
