import { Visualizer } from './Visualizer.js';

const PLANET_COUNT = 4;
const MAX_SPARKS = 120;
const STAR_COUNT = 180;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export class CelestialOrreryVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'celestial-orrery',
      name: 'Celestial Orrery',
      description: 'A cosmic mechanical clock powered by the music',
    };
  }

  static renderPreview(ctx, width, height) {
    const cx = width / 2;
    const cy = height / 2;

    ctx.strokeStyle = 'rgba(215,220,232,0.4)';
    ctx.lineWidth = 1;

    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, 20 + i * 15, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,231,168,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(128,216,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx + 40, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 40, cy);
    ctx.stroke();
  }

  #time = 0;
  #beatPulse = 0;
  #stars = [];
  #sparks = [];

  onInit() {
    this.#stars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.5 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.2 + Math.random(),
    }));

    this.#sparks = [];
  }

  render(ctx, frame, dt, { width, height }) {
    const {
      bands,
      beat,
      volume,
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

    this.#beatPulse = Math.max(
      0,
      this.#beatPulse - dt * 1.6
    );

    if (beat) {
      this.#beatPulse = 1;
    }

    const cx = width / 2;
    const cy = height / 2;
    const minDim = Math.min(width, height);

    // ==================================================
    // BACKGROUND
    // ==================================================

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
      `rgba(${8 + harmonic * 12},${10 + harmonic * 14},${20 + harmonic * 25},1)`
    );

    bg.addColorStop(1, 'rgba(3,5,9,1)');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // ==================================================
    // NEBULA
    // ==================================================

    ctx.save();

    for (let i = 0; i < 3; i++) {
      const radius =
        minDim *
        (0.35 + i * 0.08);

      const x =
        cx +
        Math.sin(
          this.#time * 0.08 + i
        ) *
          radius *
          0.25;

      const y =
        cy +
        Math.cos(
          this.#time * 0.06 + i
        ) *
          radius *
          0.18;

      const nebula =
        ctx.createRadialGradient(
          x,
          y,
          0,
          x,
          y,
          radius
        );

      nebula.addColorStop(
        0,
        `rgba(120,140,255,${
          harmonic * 0.08
        })`
      );

      nebula.addColorStop(
        1,
        'rgba(0,0,0,0)'
      );

      ctx.fillStyle = nebula;

      ctx.beginPath();
      ctx.arc(
        x,
        y,
        radius,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();

    // ==================================================
    // STARS
    // ==================================================

    ctx.save();

    for (const star of this.#stars) {
      const alpha =
        0.15 +
        Math.abs(
          Math.sin(
            star.phase +
              this.#time *
                star.speed
          )
        ) *
          (0.25 + treble * 0.6);

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;

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

    // ==================================================
    // CENTRAL STAR
    // ==================================================

    const sunRadius =
      minDim *
      (0.04 +
        bassStem * 0.03 +
        this.#beatPulse * 0.02);

    const glow =
      ctx.createRadialGradient(
        cx,
        cy,
        sunRadius * 0.2,
        cx,
        cy,
        sunRadius * 5
      );

    glow.addColorStop(
      0,
      'rgba(255,240,180,1)'
    );

    glow.addColorStop(
      0.3,
      `rgba(255,220,120,${
        0.45 +
        bassStem * 0.25
      })`
    );

    glow.addColorStop(
      1,
      'rgba(0,0,0,0)'
    );

    ctx.fillStyle = glow;

    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      sunRadius * 5,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.fillStyle = '#FFE7A8';

    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      sunRadius,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // ==================================================
    // ORBIT RINGS
    // ==================================================

    const orbitRadii = [
      minDim * 0.14,
      minDim * 0.22,
      minDim * 0.31,
      minDim * 0.41,
    ];

    ctx.save();

    orbitRadii.forEach(
      (radius, index) => {
        ctx.strokeStyle =
          `rgba(215,220,232,${
            0.12 +
            harmonic * 0.15
          })`;

        ctx.lineWidth =
          1 +
          harmonic * 0.8;

        ctx.setLineDash([
          8 + index * 2,
          10,
        ]);

        ctx.lineDashOffset =
          -this.#time *
          (8 + index * 4);

        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          radius,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
    );

    ctx.restore();

    ctx.setLineDash([]);

    // ==================================================
    // PLANETS
    // ==================================================

    const planets = [
      {
        radius: orbitRadii[0],
        size:
          8 +
          bassStem * 18,
        angle:
          this.#time *
          (0.4 +
            bassStem),
        color:
          '255,138,128',
      },
      {
        radius: orbitRadii[1],
        size:
          7 +
          drums * 16,
        angle:
          this.#time *
          (0.7 +
            drums * 1.5),
        color:
          '128,216,255',
      },
      {
        radius: orbitRadii[2],
        size:
          8 +
          vocals * 16,
        angle:
          this.#time *
          (0.28 +
            vocals),
        color:
          '225,190,231',
      },
      {
        radius: orbitRadii[3],
        size:
          8 +
          other * 16,
        angle:
          this.#time *
          (0.18 +
            other),
        color:
          '185,246,202',
      },
    ];

    const positions = [];

    planets.forEach(
      (planet, index) => {
        const x =
          cx +
          Math.cos(
            planet.angle
          ) *
            planet.radius;

        const y =
          cy +
          Math.sin(
            planet.angle
          ) *
            planet.radius;

        positions.push({
          x,
          y,
        });

        ctx.strokeStyle =
          'rgba(255,255,255,0.08)';

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();

        const glow =
          ctx.createRadialGradient(
            x,
            y,
            0,
            x,
            y,
            planet.size * 4
          );

        glow.addColorStop(
          0,
          `rgba(${planet.color},0.8)`
        );

        glow.addColorStop(
          1,
          'rgba(0,0,0,0)'
        );

        ctx.fillStyle = glow;

        ctx.beginPath();
        ctx.arc(
          x,
          y,
          planet.size * 4,
          0,
          Math.PI * 2
        );
        ctx.fill();

        ctx.fillStyle =
          `rgb(${planet.color})`;

        ctx.beginPath();
        ctx.arc(
          x,
          y,
          planet.size,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // vocal moons

        if (
          index === 2 &&
          vocals > 0.15
        ) {
          const moonCount =
            Math.floor(
              vocals * 5
            ) + 1;

          for (
            let m = 0;
            m < moonCount;
            m++
          ) {
            const moonAngle =
              this.#time *
                (1.2 + m) +
              m;

            const moonRadius =
              planet.size *
              (2.4 + m);

            const mx =
              x +
              Math.cos(
                moonAngle
              ) *
                moonRadius;

            const my =
              y +
              Math.sin(
                moonAngle
              ) *
                moonRadius;

            ctx.fillStyle =
              'rgba(255,255,255,0.8)';

            ctx.beginPath();
            ctx.arc(
              mx,
              my,
              2.5,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }
      }
    );

    // ==================================================
    // RESONANCE LINKS
    // ==================================================

    if (
      this.#beatPulse > 0.05
    ) {
      ctx.save();

      ctx.strokeStyle =
        `rgba(255,255,255,${
          this.#beatPulse *
          0.45
        })`;

      ctx.lineWidth =
        1 +
        this.#beatPulse * 3;

      for (
        let i = 0;
        i <
        positions.length - 1;
        i++
      ) {
        ctx.beginPath();

        ctx.moveTo(
          positions[i].x,
          positions[i].y
        );

        ctx.lineTo(
          positions[i + 1].x,
          positions[i + 1].y
        );

        ctx.stroke();
      }

      ctx.restore();
    }

    // ==================================================
    // DRUM SPARKS
    // ==================================================

    if (
      this.#sparks.length <
        MAX_SPARKS &&
      Math.random() <
        drums * 0.35
    ) {
      const angle =
        Math.random() *
        Math.PI *
        2;

      const radius =
        orbitRadii[1];

      this.#sparks.push({
        x:
          cx +
          Math.cos(angle) *
            radius,
        y:
          cy +
          Math.sin(angle) *
            radius,
        vx:
          Math.cos(angle) *
          (0.5 +
            Math.random()),
        vy:
          Math.sin(angle) *
          (0.5 +
            Math.random()),
        life: 1,
      });
    }

    for (const spark of this.#sparks) {
      spark.x +=
        spark.vx *
        dt *
        80;

      spark.y +=
        spark.vy *
        dt *
        80;

      spark.life -=
        dt *
        (1.4 +
          percussive);
    }

    this.#sparks =
      this.#sparks.filter(
        (s) => s.life > 0
      );

    ctx.save();

    ctx.shadowBlur = 10;
    ctx.shadowColor =
      'rgba(255,255,255,1)';

    for (const spark of this.#sparks) {
      ctx.fillStyle =
        `rgba(255,255,255,${
          spark.life
        })`;

      ctx.beginPath();
      ctx.arc(
        spark.x,
        spark.y,
        2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();

    // ==================================================
    // TITLE
    // ==================================================

    ctx.save();

    ctx.textAlign = 'center';

    ctx.fillStyle =
      `rgba(255,255,255,${
        0.2 +
        volume * 0.25
      })`;

    ctx.font =
      '12px "Segoe UI", system-ui, sans-serif';

    ctx.fillText(
      'CELESTIAL ORRERY',
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
    this.#stars = [];
    this.#sparks = [];
  }
}