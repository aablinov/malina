import type { Boss } from './kit';
import './bosses.css';

/** Полоса стража сверху экрана: имя, «страж малины», здоровье и жёлтый след, который догоняет его с задержкой */
export class BossBar {
  readonly el = document.createElement('div');
  private readonly fill: HTMLElement;
  private readonly trail: HTMLElement;
  private boss: Boss | null = null;
  private trailK = 1;
  private holdT = 0;
  private lastK = 1;

  constructor(parent: HTMLElement) {
    this.el.className = 'boss-bar';
    this.el.innerHTML = '<b></b><i></i><div class="boss-track"><div class="boss-trail"></div><div class="boss-fill"></div><span class="boss-berry"></span></div>';
    this.fill = this.el.querySelector('.boss-fill') as HTMLElement;
    this.trail = this.el.querySelector('.boss-trail') as HTMLElement;
    parent.appendChild(this.el);
  }

  get shown(): boolean { return !!this.boss; }

  show(b: Boss): void {
    this.boss = b;
    (this.el.querySelector('b') as HTMLElement).textContent = b.title;
    (this.el.querySelector('i') as HTMLElement).textContent = b.subtitle;
    this.trailK = this.lastK = 1;
    this.el.classList.add('show');
  }

  hide(): void { this.boss = null; this.el.classList.remove('show'); }

  update(dt: number): void {
    const b = this.boss;
    if (!b) return;
    const k = Math.max(0, b.hp / b.maxHp);
    if (k < this.lastK) this.holdT = 0.6;
    this.lastK = k;
    this.holdT -= dt;
    if (this.holdT <= 0) this.trailK += (k - this.trailK) * Math.min(1, dt * 4);
    if (this.trailK < k) this.trailK = k;
    this.fill.style.transform = `scaleX(${k})`;
    this.trail.style.transform = `scaleX(${this.trailK})`;
    this.el.classList.toggle('heart', b.heartOpen);
  }
}
