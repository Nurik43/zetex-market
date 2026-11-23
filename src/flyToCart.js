/** Маленькая «капля» летит от кнопки к значку корзины. */
export function flyToCart(fromEl, imageSrc) {
  if (!fromEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = document.querySelector('[data-cart-target]');
  if (!target) return;
  const a = fromEl.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const size = 44;
  const dot = document.createElement('div');
  dot.className = 'ztx-fly';
  dot.style.cssText = `left:${a.left + a.width / 2 - size / 2}px;top:${a.top + a.height / 2 - size / 2}px;width:${size}px;height:${size}px;` +
    (imageSrc ? `background-image:url("${encodeURI(imageSrc)}");` : '');
  document.body.appendChild(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = dot.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 70}px) scale(.8)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0.4 },
    ],
    { duration: 650, easing: 'cubic-bezier(.5,0,.75,.4)' },
  );
  anim.onfinish = () => {
    dot.remove();
    target.classList.remove('ztx-bump');
    void target.offsetWidth; // перезапуск анимации
    target.classList.add('ztx-bump');
  };
}
