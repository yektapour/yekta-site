/* Yekta Light page: a thin line under the top bar once you scroll, and only one video playing at a time. */
(() => {
  const top = document.getElementById('top');
  const onScroll = () => top.classList.toggle('s', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const vids = [...document.querySelectorAll('video')];
  vids.forEach(v => v.addEventListener('play', () => vids.forEach(o => { if (o !== v) o.pause(); })));
  matchMedia('(max-width:640px)').addEventListener('change', () => vids.forEach(v => v.pause()));
})();
