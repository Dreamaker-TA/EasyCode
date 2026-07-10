import type { ReviewDimension } from "@/lib/reviewDimensions";
import {
  angleForIndex,
  labelAnchor,
  pointAt,
  scaleFromCenter,
} from "@/lib/radarGeometry";

import styles from "./ReviewRadar.module.css";

interface Props {
  dimensions: ReviewDimension[];
}

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 74;
const LABEL_RADIUS = 96;
const LEVELS = [0.25, 0.5, 0.75, 1];
const GEOMETRY = { center: CENTER };

export function ReviewRadar({ dimensions }: Props) {
  const points = dimensions.map((dimension, index) => {
    const angle = angleForIndex(index, dimensions.length);
    const value = dimension.available && dimension.value !== null ? dimension.value / 100 : 0;
    return {
      dimension,
      value,
      axis: pointAt(angle, RADIUS, GEOMETRY),
      plot: pointAt(angle, RADIUS * value, GEOMETRY),
      label: pointAt(angle, LABEL_RADIUS, GEOMETRY),
    };
  });
  const polygon = points.map((point) => `${point.plot.x},${point.plot.y}`).join(" ");
  const hasShape = points.some((point) => point.value > 0);

  return (
    <figure className={styles.wrap} data-qa="review-radar">
      <svg
        className={styles.svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        {LEVELS.map((level) => (
          <polygon
            key={level}
            className={styles.grid}
            points={points
              .map((point) => {
                const scaled = scaleFromCenter(point.axis, level, GEOMETRY);
                return `${scaled.x},${scaled.y}`;
              })
              .join(" ")}
          />
        ))}
        {points.map((point) => (
          <line
            key={point.dimension.key}
            className={styles.axis}
            x1={CENTER}
            y1={CENTER}
            x2={point.axis.x}
            y2={point.axis.y}
          />
        ))}
        {hasShape && <polygon className={styles.fill} points={polygon} />}
        {hasShape && <polyline className={styles.line} points={`${polygon} ${points[0]?.plot.x},${points[0]?.plot.y}`} />}
        {points.map((point, index) => (
          <g key={point.dimension.key}>
            <circle
              className={`${styles.dot} tone-${point.dimension.tone}`}
              cx={point.plot.x}
              cy={point.plot.y}
              r={point.dimension.available ? 4 : 3}
              style={{ animationDelay: `${420 + index * 200}ms` }}
            />
            <text
              className={styles.label}
              x={point.label.x}
              y={point.label.y}
              textAnchor={labelAnchor(point.label.x, GEOMETRY)}
              dominantBaseline="middle"
              style={{ animationDelay: `${640 + index * 120}ms` }}
            >
              {point.dimension.label}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
