import * as THREE from 'three';

/**
 * Health bar above a tower or a mini-boss: two sprites (always facing the camera, on top of the scene), the fill melts to the left.
 * Fill colour goes from green to red.
 */
export class HpBar {
  readonly group = new THREE.Group();
  private readonly bg: THREE.Sprite;
  private readonly fill: THREE.Sprite;
  private readonly fillMat: THREE.SpriteMaterial;

  private readonly width: number;
  private readonly color?: string;
  constructor(width: number, y: number, color?: string) { this.width = width; this.color = color;
    const bgMat = new THREE.SpriteMaterial({ color: '#1a1012', depthTest: false, transparent: true, opacity: 0.8 });
    this.fillMat = new THREE.SpriteMaterial({ color: color ?? '#6ad84a', depthTest: false, transparent: true });
    this.bg = new THREE.Sprite(bgMat);
    this.bg.scale.set(width + 0.1, 0.2, 1);
    this.fill = new THREE.Sprite(this.fillMat);
    this.fill.scale.set(width, 0.12, 1);
    this.bg.renderOrder = 998;
    this.fill.renderOrder = 999;
    this.group.position.y = y;
    this.group.add(this.bg, this.fill);
    this.group.visible = false;
  }

  /** k — health fraction 0..1; show — whether to show at all */
  set(k: number, show: boolean): void {
    this.group.visible = show;
    if (!show) return;
    const f = Math.max(0.01, Math.min(1, k));
    this.fill.scale.x = this.width * f;
    // the fill's left edge sits at the background's left edge, in screen coordinates
    this.fill.center.set(1 / (2 * f), 0.5);
    if (!this.color) this.fillMat.color.setHSL(0.33 * f, 0.75, 0.5);
  }

  dispose(): void {
    this.bg.material.dispose();
    this.fillMat.dispose();
  }
}
