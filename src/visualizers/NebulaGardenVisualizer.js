import { Visualizer } from './Visualizer.js';

const MAX_FLOWERS = 18;
const MAX_POLLEN = 180;
const MAX_STARS = 120;
const MAX_ROOTS = 16;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class NebulaGardenVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'nebula-garden',
      name: 'Nebula Garden',
      description: 'A living cosmic ecosystem that blooms and grows with the music',
    };
  }

  static renderPreview(ctx, width, height) {
    const cx = width / 2;
    const cy = height / 2;

    const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, 90);
    bg.addColorStop(0, 'rgba(160,120,255,0.3)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,240,180,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(160,120,255,0.7)';
    ctx.lineWidth = 2;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;

      ctx.beginPath();
      ctx.moveTo(cx, cy);

      const x = cx + Math.cos(angle) * 40;
      const y = cy + Math.sin(angle) * 40;

      ctx.lineTo(x, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(168,255,241,0.8)';
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;

      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(angle) * 60,
        cy + Math.sin(angle) * 60,
        3,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  #flowers = [];
  #pollen = [];
  #stars = [];
  #roots = [];
  #time = 0;
  #bloomPulse = 0;

  onInit() {
    this.#flowers = [];
    this.#pollen = [];

    this.#stars = Array.from({ length: MAX_STARS }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.5 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.2 + Math.random(),
    }));

    this.#roots = Array.from({ length: MAX_ROOTS }, (_, i) => ({
      angle: (i / MAX_ROOTS) * Math.PI * 2,
      offset: Math.random() * Math.PI * 2,
    }));
  }

  render(ctx, frame, dt, { width, height }) {
    const {
      bands,
      volume,
      beat,
      onset,
      harmonic,
      percussive,
      stems,
    } = frame;

    const bass = bands.bass;
    const mid = bands.mid;
    const treble = bands.treble;

    const vocals = stems.vocals ?? 0;
    const drums = stems.drums ?? 0;
    const bassStem = stems.bass ?? bass;
    const other = stems.other ?? 0;

    this.#time += dt;

    if (beat) {
      this.#bloomPulse = 1;
    }

    this.#bloomPulse = Math.max(
      0,
      this.#bloomPulse - dt * 1.4
    );

    const cx = width / 2;
    const cy = height / 2;
    const minDim = Math.min(width, height);

    ctx.clearRect(0, 0, width, height);

    // ======================
    // BACKGROUND
    // ======================

    const bg = ctx.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      minDim * 0.9
    );

    bg.addColorStop(
      0,
      `rgba(${12 + bass * 25},${14 + other * 20},${28 + harmonic * 50},1)`
    );

    bg.addColorStop(0.5, 'rgba(8,10,18,1)');
    bg.addColorStop(1, 'rgba(2,3,7,1)');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // ======================
    // STARS
    // ======================

    ctx.save();

    for (const star of this.#stars) {
      const twinkle =
        0.3 +
        0.7 *
          Math.abs(
            Math.sin(
              this.#time * star.speed +
                star.phase +
                treble * 5
            )
          );

      ctx.fillStyle = `rgba(255,255,255,${(
        twinkle *
        (0.25 + treble * 0.9)
      ).toFixed(3)})`;

      ctx.beginPath();
      ctx.arc(
        star.x * width,
        star.y * height,
        star.size,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();

    // ======================
    // AURORA
    // ======================

    ctx.save();

    const auroraAlpha =
      0.05 +
      harmonic * 0.22 +
      vocals * 0.12;

    for (let layer = 0; layer < 3; layer++) {
      const offset = layer * 0.9;

      const grad = ctx.createLinearGradient(
        0,
        0,
        width,
        height
      );

      grad.addColorStop(
        0,
        `rgba(127,255,212,${auroraAlpha})`
      );

      grad.addColorStop(
        0.5,
        `rgba(94,139,255,${auroraAlpha * 1.4})`
      );

      grad.addColorStop(
        1,
        `rgba(246,184,255,${auroraAlpha})`
      );

      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;

      ctx.beginPath();

      for (let x = 0; x <= width; x += 12) {
        const t = x / width;

        const y =
          height * 0.3 +
          Math.sin(
            t * Math.PI * 4 +
              this.#time * 0.6 +
              offset
          ) *
            40 +
          Math.sin(
            t * Math.PI * 9 +
              this.#time * 0.3
          ) *
            20;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();
    }

    ctx.restore();

    // ======================
    // CORE SEED
    // ======================

    const seedRadius =
      minDim *
      (0.04 +
        bassStem * 0.03 +
        this.#bloomPulse * 0.015);

    const seedGlow = ctx.createRadialGradient(
      cx,
      cy,
      seedRadius * 0.2,
      cx,
      cy,
      seedRadius * 4
    );

    seedGlow.addColorStop(
      0,
      `rgba(255,255,220,${0.9})`
    );

    seedGlow.addColorStop(
      0.4,
      `rgba(255,226,154,${
        0.4 + harmonic * 0.3
      })`
    );

    seedGlow.addColorStop(
      1,
      'rgba(0,0,0,0)'
    );

    ctx.fillStyle = seedGlow;
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      seedRadius * 4,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.fillStyle = '#FFE29A';

    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      seedRadius,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // ======================
    // ROOTS
    // ======================

    ctx.save();

    ctx.lineCap = 'round';

    for (const root of this.#roots) {
      const rootLength =
        minDim *
        (0.12 +
          bassStem * 0.35 +
          Math.sin(
            this.#time + root.offset
          ) *
            0.02);

      ctx.strokeStyle = `rgba(154,125,255,${
        0.15 +
        bassStem * 0.45
      })`;

      ctx.lineWidth =
        1 +
        bassStem * 3;

      ctx.beginPath();
      ctx.moveTo(cx, cy);

      for (let s = 0; s < 30; s++) {
        const t = s / 29;

        const r = rootLength * t;

        const wobble =
          Math.sin(
            t * 12 +
              this.#time * 1.5 +
              root.offset
          ) *
          minDim *
          0.012;

        const angle =
          root.angle + wobble / 100;

        const x =
          cx +
          Math.cos(angle) * r;

        const y =
          cy +
          Math.sin(angle) * r;

        ctx.lineTo(x, y);
      }

      ctx.stroke();
    }

    ctx.restore();

    // ======================
    // BLOOM PETALS
    // ======================

    const petals =
      8 +
      Math.floor(vocals * 12);

    const bloomRadius =
      minDim *
      (0.13 +
        drums * 0.08 +
        this.#bloomPulse * 0.06);

    ctx.save();

    for (let i = 0; i < petals; i++) {
      const angle =
        (i / petals) *
          Math.PI *
          2 +
        this.#time * 0.1;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      const petalLength =
        bloomRadius *
        (1 +
          drums * 0.4 +
          this.#bloomPulse * 0.6);

      const petalWidth =
        petalLength * 0.22;

      ctx.fillStyle = `rgba(246,184,255,${
        0.08 +
        vocals * 0.4
      })`;

      ctx.beginPath();

      ctx.moveTo(0, 0);

      ctx.bezierCurveTo(
        petalWidth,
        -petalLength * 0.4,
        petalWidth,
        -petalLength,
        0,
        -petalLength
      );

      ctx.bezierCurveTo(
        -petalWidth,
        -petalLength,
        -petalWidth,
        -petalLength * 0.4,
        0,
        0
      );

      ctx.fill();

      ctx.restore();
    }

    ctx.restore();

    // ======================
    // VOCAL FLOWERS
    // ======================

    if (
      vocals > 0.25 &&
      this.#flowers.length < MAX_FLOWERS &&
      Math.random() <
        vocals * 0.08
    ) {
      this.#flowers.push({
        angle: Math.random() * Math.PI * 2,
        distance:
          minDim *
          (0.18 +
            Math.random() * 0.28),
        size:
          6 +
          Math.random() * 12,
        life: 1,
        speed:
          0.2 +
          Math.random() * 0.4,
      });
    }

    for (const flower of this.#flowers) {
      flower.life -= dt * 0.08;
      flower.angle += dt * flower.speed;
    }

    this.#flowers =
      this.#flowers.filter(
        (f) => f.life > 0
      );

    ctx.save();

    for (const flower of this.#flowers) {
      const x =
        cx +
        Math.cos(flower.angle) *
          flower.distance;

      const y =
        cy +
        Math.sin(flower.angle) *
          flower.distance;

      const alpha =
        flower.life *
        (0.4 + vocals * 0.6);

      ctx.fillStyle = `rgba(255,240,180,${alpha})`;

      ctx.beginPath();
      ctx.arc(
        x,
        y,
        flower.size,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.fillStyle = `rgba(255,255,255,${
        alpha * 0.8
      })`;

      ctx.beginPath();
      ctx.arc(
        x,
        y,
        flower.size * 0.35,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();

    // ======================
    // POLLEN
    // ======================

    const pollenSpawn =
      1 +
      Math.floor(
        percussive * 4
      );

    for (
      let i = 0;
      i < pollenSpawn &&
      this.#pollen.length <
        MAX_POLLEN;
      i++
    ) {
      if (
        Math.random() <
        0.3 + percussive * 0.5
      ) {
        this.#pollen.push({
          x:
            cx +
            (Math.random() - 0.5) *
              minDim *
              0.3,
          y:
            cy +
            (Math.random() - 0.5) *
              minDim *
              0.3,
          vx:
            (Math.random() - 0.5) *
            0.5,
          vy:
            -0.2 -
            Math.random() * 0.8,
          size:
            1 +
            Math.random() * 3,
          life: 1,
        });
      }
    }

    for (const p of this.#pollen) {
      p.x +=
        p.vx *
        dt *
        40;

      p.y +=
        p.vy *
        dt *
        40;

      p.life -=
        dt *
        (0.2 +
          volume * 0.15);
    }

    this.#pollen =
      this.#pollen.filter(
        (p) => p.life > 0
      );

    ctx.save();

    ctx.shadowColor =
      'rgba(168,255,241,1)';
    ctx.shadowBlur = 10;

    for (const p of this.#pollen) {
      ctx.fillStyle = `rgba(168,255,241,${
        p.life * 0.7
      })`;

      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        p.size,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();

    // ======================
    // TITLE
    // ======================

    ctx.save();

    ctx.textAlign = 'center';

    ctx.fillStyle = `rgba(255,255,255,${
      0.25 + volume * 0.2
    })`;

    ctx.font =
      '12px "Segoe UI", system-ui, sans-serif';

    ctx.fillText(
      'NEBULA GARDEN',
      cx,
      height -
        Math.max(
          18,
          height * 0.08
        )
    );

    ctx.restore();
  }

  onDestroy() {
    this.#flowers = [];
    this.#pollen = [];
    this.#stars = [];
    this.#roots = [];
  }
}