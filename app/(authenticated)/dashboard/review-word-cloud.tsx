'use client';

/**
 * Review word cloud — two packed clouds of the words customers actually used,
 * split by the rating of the review they came from:
 *
 *   left  (green) → words from 4–5★ reviews
 *   right (red)   → words from 1–2★ reviews
 *
 * Arabic and English words share one cloud, since an Arabic review carries
 * Google's English translation in the same text field and both are real
 * customer voice.
 *
 * Words come pre-aggregated from the `review_word_cloud` view (client schema),
 * so this component only lays them out. Font size scales with frequency;
 * placement is a greedy Archimedean-spiral pack with rectangle collision, which
 * is deterministic — the same input always produces the same cloud.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BiInline, useT } from '@/lib/bilingual';

export interface WordFreq {
  word: string;
  freq: number;
}

export interface ReviewWordCloudData {
  positive: WordFreq[];
  negative: WordFreq[];
}

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Tahoma, 'Helvetica Neue', sans-serif";

/** Darkest → lightest. Big (frequent) words get the darkest shade. */
const GREENS = ['#14532d', '#166534', '#15803d', '#16a34a', '#22c55e', '#4ade80', '#86efac'];
const REDS = ['#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444', '#f87171', '#fca5a5'];

interface Placed extends WordFreq {
  x: number;
  y: number;
  size: number;
  color: string;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAX_FONT = 50;
const MIN_FONT = 12;

/**
 * Pack words into a W×H box. Largest first, each one walking outward along a
 * spiral until it finds a spot that overlaps nothing already placed. Words that
 * never fit are dropped rather than overlapped.
 */
function packWords(words: WordFreq[], W: number, H: number, palette: string[]): Placed[] {
  if (words.length === 0) return [];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const freqs = words.map(w => w.freq);
  const maxF = Math.max(...freqs);
  const minF = Math.min(...freqs);
  const rootMax = Math.sqrt(maxF);
  const rootMin = Math.sqrt(minF);

  // sqrt scale — linear scaling lets one runaway word swallow the whole cloud.
  const fontFor = (f: number) => {
    if (rootMax === rootMin) return (MAX_FONT + MIN_FONT) / 2;
    const t = (Math.sqrt(f) - rootMin) / (rootMax - rootMin);
    return MIN_FONT + t * (MAX_FONT - MIN_FONT);
  };

  const cx = W / 2;
  const cy = H / 2;
  const boxes: Box[] = [];
  const placed: Placed[] = [];
  const PAD = 3;

  const collides = (b: Box) =>
    boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

  words.forEach((wd, i) => {
    const size = fontFor(wd.freq);
    ctx.font = `800 ${size}px ${FONT_STACK}`;
    const tw = ctx.measureText(wd.word).width + PAD * 2;
    const th = size * 1.02 + PAD * 2;

    // Deterministic per-word offset so equal-frequency words don't stack into
    // a visible column. Derived from the index, never from Math.random.
    const jitter = ((i * 2654435761) % 1000) / 1000;

    for (let t = 0; t < 4000; t++) {
      const ang = t * 0.22 + jitter * Math.PI * 2;
      const rad = 1.4 * ang;
      // Stretched horizontally — reads better in a wide card than a disc does.
      const x = cx + rad * Math.cos(ang) * 1.75;
      const y = cy + rad * Math.sin(ang) * 0.85;

      const box: Box = { x0: x - tw / 2, y0: y - th / 2, x1: x + tw / 2, y1: y + th / 2 };
      if (box.x0 < 0 || box.y0 < 0 || box.x1 > W || box.y1 > H) continue;
      if (collides(box)) continue;

      boxes.push(box);
      placed.push({
        ...wd,
        x,
        y,
        size,
        color: palette[Math.min(palette.length - 1, Math.floor((i / words.length) * palette.length))],
      });
      break;
    }
  });

  return placed;
}

function Cloud({
  title,
  words,
  palette,
  emptyLabel,
}: {
  title: React.ReactNode;
  words: WordFreq[];
  palette: string[];
  emptyLabel: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const HEIGHT = 470;

  // Measure the container so the cloud reflows with the card.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout needs canvas text measurement, so it runs after mount only. This
  // also keeps the server-rendered markup free of client-measured coordinates.
  useEffect(() => {
    if (width <= 0) {
      setPlaced([]);
      return;
    }
    setPlaced(packWords(words, width, HEIGHT, palette));
  }, [words, width, palette]);

  const total = useMemo(() => words.reduce((s, w) => s + w.freq, 0), [words]);

  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-3">
        <h4 className="text-base font-black text-slate-800 tracking-tight">{title}</h4>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {words.length.toLocaleString()} · {total.toLocaleString()}
        </span>
      </div>

      <div ref={hostRef} className="mt-4" style={{ minHeight: HEIGHT }}>
        {words.length === 0 ? (
          <div className="flex items-center justify-center text-xs font-bold text-slate-300" style={{ height: HEIGHT }}>
            {emptyLabel}
          </div>
        ) : (
          <svg width="100%" height={HEIGHT} viewBox={`0 0 ${Math.max(width, 1)} ${HEIGHT}`} role="img">
            {placed.map(p => (
              <text
                key={`${p.word}-${p.freq}`}
                x={p.x}
                y={p.y}
                fontSize={p.size}
                fontWeight={800}
                fill={p.color}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ fontFamily: FONT_STACK }}
              >
                <title>{`${p.word} — ${p.freq.toLocaleString()}`}</title>
                {p.word}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

export default function ReviewWordCloud({ data }: { data: ReviewWordCloudData }) {
  const t = useT();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
      <Cloud
        title={<BiInline en="Reviews: Positive" />}
        words={data.positive}
        palette={GREENS}
        emptyLabel={t('No positive review text yet')}
      />
      <Cloud
        title={<BiInline en="Reviews: Negative" />}
        words={data.negative}
        palette={REDS}
        emptyLabel={t('No negative review text yet')}
      />
    </div>
  );
}
