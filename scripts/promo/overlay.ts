/**
 * The trailer's graphics, drawn in the page over the game (scripts/promo/record.ts): slanted caption slabs, the three-stripe
 * wipe between scenes, an impact flash and the end card. Everything is a pure function of the scene time — the recorder
 * shoots frame by frame, nothing here runs on a clock.
 * The function is serialised into the page: it must not close over anything.
 */
export interface OverlayFrame {
  /** Scene time and length, seconds */
  t: number; dur: number;
  /** Small chip above the caption and the caption itself */
  tag?: string; title?: string;
  /** Where the caption sits */
  side?: 'left' | 'right';
  /** White flash strength 0..1 */
  flash?: number;
  /** End card: the logo instead of a caption */
  logo?: boolean;
  /** No wipe at the start / at the end of the scene */
  noIn?: boolean; noOut?: boolean;
}

export function installOverlay(): void {
  const PINK = '#ff2d6f', YELLOW = '#ffe21f', NAVY = '#1d0f45';
  const css = `
  #promo{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;font-family:'Luckiest Guy','Rubik',sans-serif;color:#fff}
  #promo *{position:absolute;box-sizing:border-box}
  #promo .bar{left:-30%;top:-10%;width:160%;height:120%;transform-origin:50% 50%}
  #promo .flash{inset:0;background:#fff}
  #promo .vig{inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 55%,rgba(10,4,30,.55) 100%)}
  #promo .cap{bottom:9%;transform-origin:0 100%}
  #promo .cap .slab{position:relative;display:block;padding:14px 34px 4px 30px;background:${YELLOW};color:${NAVY};font-size:74px;line-height:1;letter-spacing:1px;white-space:nowrap;
    box-shadow:10px 10px 0 ${NAVY};clip-path:polygon(0 0,100% 0,calc(100% - 22px) 100%,0 100%)}
  #promo .cap .tag{position:relative;display:inline-block;margin:0 0 -2px 0;padding:8px 26px 2px 18px;background:${PINK};color:#fff;font-size:26px;line-height:1;letter-spacing:2px;white-space:nowrap;
    clip-path:polygon(0 0,100% 0,calc(100% - 12px) 100%,0 100%)}
  #promo .cap .row{position:relative;display:block}
  #promo .end{inset:0}
  #promo .end .bg{inset:0;background:radial-gradient(circle at 50% 46%,rgba(255,45,111,.5) 0%,rgba(110,20,120,.7) 50%,rgba(20,8,50,.92) 100%)}
  #promo .end .rays{left:50%;top:46%;width:2400px;height:2400px;margin:-1200px 0 0 -1200px;border-radius:50%;
    background:repeating-conic-gradient(rgba(255,255,255,.10) 0 7deg,transparent 7deg 18deg)}
  #promo .end .logo{left:0;right:0;top:25%;text-align:center;font:400 150px/1 'Press Start 2P',monospace;color:#fff;
    text-shadow:0 12px 0 ${NAVY},0 0 60px rgba(255,45,111,.9)}
  #promo .end .sub{left:50%;top:60%;white-space:nowrap;padding:12px 34px 4px;background:${YELLOW};color:${NAVY};font-size:40px;line-height:1;letter-spacing:2px;box-shadow:8px 8px 0 ${NAVY}}
  #promo .end .foot{left:0;right:0;top:76%;text-align:center;font-size:28px;letter-spacing:3px;color:#fff;text-shadow:0 4px 0 ${NAVY}}
    `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'promo';
  root.innerHTML = `<div class="vig"></div><div class="cap"><span class="row"><span class="tag"></span></span><span class="row"><span class="slab"></span></span></div>
    <div class="end"><div class="bg"></div><div class="rays"></div><div class="logo">MALINA</div><div class="sub"></div><div class="foot"></div></div>
    <div class="flash"></div><div class="bar b0"></div><div class="bar b1"></div><div class="bar b2"></div>`;
  document.body.appendChild(root);
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  const cap = $('.cap'), tag = $('.tag'), slab = $('.slab'), flash = $('.flash'), end = $('.end'), logo = $('.logo'), sub = $('.sub'), foot = $('.foot'), rays = $('.rays');
  const bars = [$('.b0'), $('.b1'), $('.b2')], colours = [NAVY, YELLOW, PINK];
  bars.forEach((b, i) => { b.style.background = colours[i]; });
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const outCubic = (x: number) => 1 - (1 - x) ** 3, inCubic = (x: number) => x ** 3;
  const back = (x: number) => { const c = 2.2; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
  const IN = 0.34, OUT = 0.3;

  (window as any).__overlay = (f: OverlayFrame) => {
    const left = f.dur - f.t;
    // ---- wipe: the stripes sweep in from the left to cover the frame, and leave to the right on the next scene
    bars.forEach((b, i) => {
      let x = -200; // percent of the bar's own width: −200 — off to the left, 0 — covering, 200 — off to the right
      if (!f.noIn && f.t < IN) { const p = clamp(f.t / IN * 1.5 - (2 - i) * 0.25); x = outCubic(p) * 130; }
      else if (!f.noOut && left < OUT) { const p = clamp((1 - left / OUT) * 1.5 - i * 0.25); x = -130 + inCubic(p) * 130; }
      b.style.display = x <= -200 ? 'none' : 'block';
      b.style.transform = `translateX(${x}%) skewX(-18deg)`;
    });
    // ---- flash
    flash.style.opacity = String(clamp(f.flash ?? 0));
    // ---- caption
    const show = !!f.title && !f.logo;
    cap.style.display = show ? 'block' : 'none';
    if (show) {
      const a = 0.28, at = f.t - a, life = f.dur - OUT - 0.12 - a;
      tag.textContent = f.tag ?? ''; tag.style.display = f.tag ? 'inline-block' : 'none';
      slab.textContent = f.title ?? '';
      const pin = clamp(at / 0.3), pout = clamp((at - life) / 0.16), right = f.side === 'right';
      const dx = (1 - back(pin)) * -900 + inCubic(pout) * -1100, drift = Math.max(0, at) * 9;
      const punch = 1 + 0.16 * (1 - clamp(at / 0.42)) ** 2;
      cap.style.opacity = at < 0 ? '0' : '1';
      if (right) { cap.style.left = 'auto'; cap.style.right = '5%'; cap.style.transformOrigin = '100% 100%'; cap.style.textAlign = 'right'; }
      else { cap.style.right = 'auto'; cap.style.left = '5%'; cap.style.transformOrigin = '0 100%'; cap.style.textAlign = 'left'; }
      cap.style.transform = `translateX(${(right ? -1 : 1) * (dx + drift)}px) rotate(-4deg) skewX(-8deg) scale(${punch})`;
      // the chip comes a beat after the slab
      const tp = clamp((at - 0.1) / 0.22);
      tag.style.transform = `translateX(${(1 - outCubic(tp)) * -260}px)`; tag.style.opacity = String(tp);
    }
    // ---- end card
    end.style.display = f.logo ? 'block' : 'none';
    if (f.logo) {
      const a = 0.3, at = Math.max(0, f.t - a);
      const p = clamp(at / 0.34), s = 3.2 - 2.2 * back(p) + 0.02 * at;
      logo.style.opacity = f.t < a ? '0' : '1';
      logo.style.transform = `rotate(-4deg) skewX(-6deg) scale(${s})`;
      rays.style.transform = `rotate(${f.t * 14}deg)`;
      sub.textContent = f.title ?? '';
      const sp = clamp((at - 0.32) / 0.3);
      sub.style.opacity = String(sp > 0 ? 1 : 0);
      sub.style.transform = `translateX(-50%) translateX(${(1 - back(sp)) * -1200}px) rotate(-4deg) skewX(-8deg)`;
      const fp = clamp((at - 0.7) / 0.3);
      foot.innerHTML = f.tag ?? '';
      foot.style.opacity = String(fp);
      foot.style.transform = `translateY(${(1 - outCubic(fp)) * 30}px)`;
    }
  };
}
