import { h, icon } from './ui.ts';

/**
 * Аутлайнер — дерево объектов карты, как World Outliner в Unreal: глаз (видимость), имя, тип.
 * Дерево ленивое (дети строятся при раскрытии), список виртуальный — рисуются только видимые строки,
 * поэтому тысячи блоков не тормозят. Поиск фильтрует по имени и типу (кроме «тяжёлых» узлов — списков клеток).
 */

export interface TreeNode {
  id: string;
  label: string;
  icon: string;
  type: string;
  kids?: () => TreeNode[];
  /** Число в скобках у групп */
  count?: number;
  eye?: { get(): boolean; set(v: boolean): void };
  /** Детей не обходить при поиске (длинные списки клеток) */
  heavy?: boolean;
}

interface Row { node: TreeNode; depth: number; open: boolean; leaf: boolean }

const ROW_H = 20;

export interface OutlinerOpts {
  roots: () => TreeNode[];
  isSelected: (id: string) => boolean;
  onSelect: (node: TreeNode, ev: MouseEvent) => void;
  onDbl: (node: TreeNode) => void;
  onContext: (node: TreeNode, ev: MouseEvent) => void;
}

export class Outliner {
  readonly el = h('div.ue-outl');
  readonly expanded = new Set<string>(['root', 'world', 'actors']);
  private readonly search: HTMLInputElement;
  private readonly scroller = h('div.ue-outl-scroll');
  private readonly spacer = h('div.ue-outl-spacer');
  private readonly rowsEl = h('div.ue-outl-rows');
  private readonly countEl = h('div.ue-outl-count');
  private rows: Row[] = [];
  private filter = '';
  private dirty = true;

  private readonly o: OutlinerOpts;
  constructor(o: OutlinerOpts) { this.o = o;
    this.search = h('input.ue-search', { type: 'search', placeholder: 'Поиск…', spellcheck: 'false' });
    this.search.addEventListener('input', () => { this.filter = this.search.value.trim().toLowerCase(); this.invalidate(); });
    this.search.addEventListener('keydown', (e) => e.stopPropagation());
    const head = h('div.ue-outl-head', { html: `<span class="ue-outl-c-eye">${icon('eye')}</span><span class="ue-outl-c-l">Имя</span><span class="ue-outl-c-t">Тип</span>` });
    this.scroller.append(this.spacer, this.rowsEl);
    this.el.append(h('div.ue-outl-bar', {}, h('span.ue-search-ic', { html: icon('search') }), this.search), head, this.scroller, this.countEl);
    this.scroller.addEventListener('scroll', () => this.draw());
    new ResizeObserver(() => this.draw()).observe(this.scroller);
  }

  /** Карта изменилась — пересобрать дерево в следующем кадре */
  invalidate(): void { this.dirty = true; }

  /** Вызывать из кадра: пересобирает дерево, только если что-то менялось */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rows = [];
    const f = this.filter;
    const match = (n: TreeNode): boolean => n.label.toLowerCase().includes(f) || n.type.toLowerCase().includes(f);
    const walk = (nodes: TreeNode[], depth: number): void => {
      for (const n of nodes) {
        if (f) {
          const kids = n.kids && !n.heavy ? n.kids() : [];
          // при поиске: узел виден, если совпал сам или кто-то из потомков (тяжёлые узлы — только сами)
          const sub: Row[] = [];
          const before = this.rows.length;
          if (kids.length) { const save = this.rows; this.rows = sub; walk(kids, depth + 1); this.rows = save; }
          if (match(n) || sub.length) {
            this.rows.splice(before, 0, { node: n, depth, open: sub.length > 0, leaf: !n.kids || n.count === 0 }, ...sub);
          }
          continue;
        }
        const open = this.expanded.has(n.id);
        this.rows.push({ node: n, depth, open, leaf: !n.kids || (n.count === 0) });
        if (open && n.kids) walk(n.kids(), depth + 1);
      }
    };
    walk(this.o.roots(), 0);
    this.spacer.style.height = `${this.rows.length * ROW_H}px`;
    this.draw();
  }

  /** Обновить подсветку выделения без пересборки */
  redraw(): void { this.draw(); }

  /** Раскрыть путь и прокрутить к узлу (выбор в вьюпорте) */
  reveal(path: string[], id: string): void {
    let changed = false;
    for (const p of path) if (!this.expanded.has(p)) { this.expanded.add(p); changed = true; }
    if (changed) { this.dirty = true; this.update(); }
    const i = this.rows.findIndex((r) => r.node.id === id);
    if (i < 0) return;
    const top = i * ROW_H, s = this.scroller;
    if (top < s.scrollTop || top > s.scrollTop + s.clientHeight - ROW_H) s.scrollTop = top - s.clientHeight / 2;
    this.draw();
  }

  private draw(): void {
    const s = this.scroller;
    const first = Math.max(0, Math.floor(s.scrollTop / ROW_H) - 4);
    const last = Math.min(this.rows.length, Math.ceil((s.scrollTop + s.clientHeight) / ROW_H) + 4);
    this.rowsEl.textContent = '';
    this.rowsEl.style.transform = `translateY(${first * ROW_H}px)`;
    let nSel = 0;
    for (let i = first; i < last; i++) {
      const r = this.rows[i];
      const n = r.node;
      const sel = this.o.isSelected(n.id);
      const row = h('div.ue-outl-row');
      if (sel) row.classList.add('sel');
      if (i % 2) row.classList.add('odd');
      const eye = h('span.ue-outl-eye', { html: n.eye ? icon(n.eye.get() ? 'eye' : 'eyeOff') : '' });
      if (n.eye) eye.addEventListener('click', (e) => { e.stopPropagation(); n.eye!.set(!n.eye!.get()); this.draw(); });
      const tri = h('span.ue-outl-tri', { html: r.leaf ? '' : icon('chevron', r.open ? 'open' : '') });
      tri.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(n.id); });
      const label = h('span.ue-outl-l', { style: `padding-left:${r.depth * 12}px` }, tri, h('span.ue-outl-ic', { html: icon(n.icon) }), h('span.ue-outl-name', { text: n.label }), n.count !== undefined ? h('span.ue-outl-n', { text: ` (${n.count})` }) : null);
      row.append(eye, label, h('span.ue-outl-t', { text: n.type }));
      row.addEventListener('click', (e) => this.o.onSelect(n, e));
      row.addEventListener('dblclick', () => { if (!r.leaf && !n.eye) this.toggle(n.id); this.o.onDbl(n); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); this.o.onContext(n, e); });
      this.rowsEl.append(row);
    }
    for (const r of this.rows) if (this.o.isSelected(r.node.id)) nSel++;
    this.countEl.textContent = `${this.rows.length} строк${nSel ? ` · ${nSel} выбрано` : ''}`;
  }

  toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.dirty = true;
    this.update();
  }
}
