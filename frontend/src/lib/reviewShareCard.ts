import type { Language, Rating } from "@/api/types";
import { formatLocalDateStamp, formatLocalDateValue } from "@/lib/datetime";
import {
  angleForIndex,
  labelAnchor,
  pointAt,
  scaleFromCenter,
} from "@/lib/radarGeometry";
import type { ReviewDimension } from "@/lib/reviewDimensions";
import type { ReviewExportInfo } from "@/lib/reviewExportMarkdown";
import { formatProblemTitle } from "@/lib/reviewExportMarkdown";
import { tokens } from "@/styles/tokens";

export interface RenderShareCardInput {
  exportInfo: ReviewExportInfo;
  submission: ReviewShareCardSubmissionInfo;
  dimensions: ReviewDimension[];
  diagnosis: string;
  effectiveRating: Rating | null;
}

export interface ReviewShareCardSubmissionInfo {
  language: Language;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
}

interface TextBlockOptions {
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
  maxFontSize: number;
  minFontSize: number;
  weight: number;
  family: string;
  color: string;
  lineHeightRatio?: number;
  maxLines?: number;
}

interface TextBlockResult {
  fontSize: number;
  lineHeight: number;
  lineCount: number;
  bottomY: number;
}

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const SHARE_CARD_BG = "/share-card-bg-generated.jpg";
const LEVELS = [0.25, 0.5, 0.75, 1];
const PAPER_X = 52;
const PAPER_Y = 40;
const PAPER_W = 1096;
const PAPER_H = 550;
const LEFT_X = 84;
const LEFT_W = 612;
const DIVIDER_X = 724;
const RIGHT_PANEL_X = 760;
const RIGHT_PANEL_W = 352;

export async function renderShareCardToCanvas(
  canvas: HTMLCanvasElement,
  input: RenderShareCardInput,
): Promise<void> {
  await waitForFonts();
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");

  const color = tokens.light;
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  await drawBackground(ctx);

  ctx.fillStyle = color.bgElevated;
  roundedRect(ctx, PAPER_X, PAPER_Y, PAPER_W, PAPER_H, tokens.radius.lg);
  ctx.fill();
  ctx.strokeStyle = color.lineStrong;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = color.lineStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(DIVIDER_X, PAPER_Y + 42);
  ctx.lineTo(DIVIDER_X, PAPER_Y + PAPER_H - 42);
  ctx.stroke();

  const diagnosisY = drawHeader(ctx, input);
  drawDiagnosis(ctx, input.diagnosis, diagnosisY);
  drawRatingPanel(ctx, input.effectiveRating, input.submission);
  drawRadar(ctx, input.dimensions);
  drawFooter(ctx, input.submission);

  ctx.strokeStyle = color.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAPER_X, PAPER_Y + PAPER_H);
  ctx.lineTo(PAPER_X + PAPER_W, PAPER_Y + PAPER_H);
  ctx.stroke();
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas did not produce a PNG blob"));
    }, "image/png");
  });
}

export function buildShareCardFilename(
  exportInfo: ReviewExportInfo,
  date = new Date(),
): string {
  const id = exportInfo.leetcodeId ?? exportInfo.externalId ?? `problem-${exportInfo.problemId}`;
  return `easycode-share-card-${String(id).replace(/[^a-zA-Z0-9._-]+/g, "-")}-${formatLocalDateStamp(date)}.png`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

async function drawBackground(ctx: CanvasRenderingContext2D): Promise<void> {
  const color = tokens.light;
  try {
    const image = await loadImage(SHARE_CARD_BG);
    drawImageCover(ctx, image, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  } catch {
    ctx.fillStyle = color.bg;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, input: RenderShareCardInput): number {
  const color = tokens.light;
  drawBrandLockup(ctx);

  const title = drawFitTextBlock(ctx, formatProblemTitle(input.exportInfo), {
    x: LEFT_X,
    y: 168,
    maxWidth: LEFT_W,
    maxHeight: 110,
    maxFontSize: 48,
    minFontSize: 32,
    weight: 760,
    family: tokens.font.sans,
    color: color.ink,
    lineHeightRatio: 1.14,
    maxLines: 2,
  });

  const metaY = title.bottomY + 24;
  ctx.fillStyle = color.inkMuted;
  ctx.font = `620 21px ${tokens.font.sans}`;
  ctx.fillText(`${formatLanguage(input.submission.language)} · 五维训练复盘`, LEFT_X, metaY);
  return metaY + 34;
}

function drawBrandLockup(ctx: CanvasRenderingContext2D): void {
  const color = tokens.light;
  const x = LEFT_X;
  const y = 70;

  drawHandCheck(ctx, x, y + 2, 32);

  ctx.fillStyle = color.ink;
  ctx.font = `780 31px ${tokens.font.sans}`;
  ctx.textAlign = "left";
  ctx.fillText("EasyCode", x + 46, y + 27);

  ctx.fillStyle = color.inkSubtle;
  ctx.font = `700 14px ${tokens.font.mono}`;
  ctx.fillText("训练复盘卡", x + 48, y + 49);
}

function drawHandCheck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const color = tokens.light;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.1, y + size * 0.52);
  ctx.bezierCurveTo(
    x + size * 0.23,
    y + size * 0.66,
    x + size * 0.31,
    y + size * 0.78,
    x + size * 0.42,
    y + size * 0.83,
  );
  ctx.bezierCurveTo(
    x + size * 0.58,
    y + size * 0.48,
    x + size * 0.75,
    y + size * 0.27,
    x + size * 0.96,
    y + size * 0.12,
  );
  ctx.stroke();
  ctx.restore();
}

function drawDiagnosis(
  ctx: CanvasRenderingContext2D,
  diagnosis: string,
  y: number,
) {
  const color = tokens.light;
  const x = LEFT_X;
  const width = LEFT_W;
  const height = Math.min(218, Math.max(160, 518 - y));

  ctx.fillStyle = color.bgSoft;
  roundedRect(ctx, x, y, width, height, tokens.radius.md);
  ctx.fill();
  ctx.strokeStyle = color.lineStrong;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color.inkSubtle;
  ctx.font = `700 18px ${tokens.font.mono}`;
  ctx.fillText("主诊断", x + 24, y + 36);

  drawFitTextBlock(ctx, diagnosis, {
    x: x + 24,
    y: y + 70,
    maxWidth: width - 48,
    maxHeight: height - 86,
    maxFontSize: 23,
    minFontSize: 18,
    weight: 420,
    family: tokens.font.serif,
    color: color.ink,
    lineHeightRatio: 1.3,
    maxLines: 4,
  });
}

function drawRatingPanel(
  ctx: CanvasRenderingContext2D,
  rating: Rating | null,
  submission: ReviewShareCardSubmissionInfo,
) {
  const color = tokens.light;
  const stampColor = ratingColor(rating);
  const x = RIGHT_PANEL_X;
  const y = 84;
  const width = RIGHT_PANEL_W;
  const height = 142;

  ctx.fillStyle = color.bgSoft;
  roundedRect(ctx, x, y, width, height, tokens.radius.lg);
  ctx.fill();
  ctx.strokeStyle = color.lineStrong;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color.inkSubtle;
  ctx.font = `700 18px ${tokens.font.mono}`;
  ctx.fillText("本次评级", x + 24, y + 40);

  ctx.fillStyle = stampColor;
  ctx.font = `850 88px ${tokens.font.mono}`;
  ctx.fillText(rating ?? "-", x + 24, y + 120);

  ctx.fillStyle = color.inkMuted;
  ctx.textAlign = "right";
  ctx.font = `600 16px ${tokens.font.mono}`;
  ctx.fillText("语言", x + width - 24, y + 66);
  ctx.fillStyle = color.ink;
  ctx.font = `760 24px ${tokens.font.sans}`;
  ctx.fillText(formatLanguage(submission.language), x + width - 24, y + 96);
  ctx.fillStyle = color.inkMuted;
  ctx.font = `600 15px ${tokens.font.mono}`;
  ctx.fillText("五维复盘", x + width - 24, y + 120);
  ctx.textAlign = "left";
}

function drawRadar(ctx: CanvasRenderingContext2D, dimensions: ReviewDimension[]) {
  const color = tokens.light;
  const panelX = RIGHT_PANEL_X;
  const panelY = 246;
  const panelW = RIGHT_PANEL_W;
  const panelH = 272;
  const size = 248;
  const originX = panelX + (panelW - size) / 2;
  const originY = panelY + 12;
  const geometry = { center: size / 2 };
  const radius = 78;
  const labelRadius = 104;
  const points = dimensions.map((dimension, index) => {
    const angle = angleForIndex(index, dimensions.length);
    const value = dimension.available && dimension.value !== null ? dimension.value / 100 : 0;
    return {
      dimension,
      value,
      axis: pointAt(angle, radius, geometry),
      plot: pointAt(angle, radius * value, geometry),
      label: pointAt(angle, labelRadius, geometry),
    };
  });

  ctx.save();

  ctx.fillStyle = color.bgSoft;
  roundedRect(ctx, panelX, panelY, panelW, panelH, tokens.radius.lg);
  ctx.fill();
  ctx.strokeStyle = color.lineStrong;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.translate(originX, originY);

  ctx.strokeStyle = "rgba(214, 210, 202, 0.92)";
  ctx.lineWidth = 1.5;
  for (const level of LEVELS) {
    const levelPoints = points.map((point) => scaleFromCenter(point.axis, level, geometry));
    drawClosedPath(ctx, levelPoints);
    ctx.stroke();
  }
  for (const point of points) {
    ctx.beginPath();
    ctx.moveTo(geometry.center, geometry.center);
    ctx.lineTo(point.axis.x, point.axis.y);
    ctx.stroke();
  }

  const plot = points.map((point) => point.plot);
  if (plot.some((point) => point.x !== geometry.center || point.y !== geometry.center)) {
    drawClosedPath(ctx, plot);
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = color.accent;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = color.accent;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  for (const point of points) {
    ctx.fillStyle = toneColor(point.dimension.tone);
    ctx.beginPath();
    ctx.arc(point.plot.x, point.plot.y, point.dimension.available ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color.inkMuted;
    ctx.font = `700 16px ${tokens.font.sans}`;
    ctx.textAlign = canvasTextAlign(labelAnchor(point.label.x, geometry, 16));
    ctx.textBaseline = "middle";
    ctx.fillText(point.dimension.label, point.label.x, point.label.y);
  }
  ctx.restore();
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  submission: ReviewShareCardSubmissionInfo,
) {
  const color = tokens.light;
  const reviewDate =
    submission.reviewedAt ?? submission.submittedAt ?? submission.createdAt;
  const y = 554;

  ctx.fillStyle = color.inkMuted;
  ctx.font = `500 15px ${tokens.font.mono}`;
  ctx.textAlign = "left";
  ctx.fillText("local algorithm practice review", LEFT_X, y);

  ctx.fillStyle = color.inkSubtle;
  ctx.font = `500 14px ${tokens.font.mono}`;
  ctx.textAlign = "right";
  ctx.fillText(formatReviewDate(reviewDate), PAPER_X + PAPER_W - 36, y);
  ctx.textAlign = "left";
}

function drawFitTextBlock(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  options: TextBlockOptions,
): TextBlockResult {
  const text = normalizeText(rawText);
  const ratio = options.lineHeightRatio ?? 1.22;
  let best: { fontSize: number; lineHeight: number; lines: string[] } | null = null;

  const floorFontSize = options.minFontSize;
  for (let fontSize = options.maxFontSize; fontSize >= floorFontSize; fontSize -= 1) {
    ctx.font = `${options.weight} ${fontSize}px ${options.family}`;
    const lines = clampLines(ctx, wrapText(ctx, text, options.maxWidth), options);
    const lineHeight = Math.ceil(fontSize * ratio);
    if (lines.length * lineHeight <= options.maxHeight) {
      best = { fontSize, lineHeight, lines };
      break;
    }
  }

  if (!best) {
    ctx.font = `${options.weight} ${floorFontSize}px ${options.family}`;
    const lines = clampLines(ctx, wrapText(ctx, text, options.maxWidth), options);
    best = {
      fontSize: floorFontSize,
      lineHeight: Math.max(8, Math.floor(options.maxHeight / Math.max(1, lines.length))),
      lines,
    };
  }
  if (best.lines.length * best.lineHeight > options.maxHeight) {
    best.lineHeight = Math.max(8, Math.floor(options.maxHeight / Math.max(1, best.lines.length)));
  }

  ctx.fillStyle = options.color;
  ctx.font = `${options.weight} ${best.fontSize}px ${options.family}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  best.lines.forEach((line, index) => {
    ctx.fillText(line, options.x, options.y + index * best.lineHeight);
  });
  return {
    fontSize: best.fontSize,
    lineHeight: best.lineHeight,
    lineCount: best.lines.length,
    bottomY: options.y + Math.max(0, best.lines.length - 1) * best.lineHeight,
  };
}

function clampLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  options: TextBlockOptions,
): string[] {
  if (!options.maxLines || lines.length <= options.maxLines) return lines;
  const clamped = lines.slice(0, options.maxLines);
  const chars = Array.from(clamped[clamped.length - 1] ?? "");
  while (
    chars.length > 0 &&
    ctx.measureText(`${chars.join("")}…`).width > options.maxWidth
  ) {
    chars.pop();
  }
  clamped[clamped.length - 1] = `${chars.join("")}…`;
  return clamped;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const charWrap = /[\u3400-\u9fff]/u.test(text);
  const words = charWrap ? Array.from(text) : text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const joiner = !charWrap && current ? " " : "";
    const next = `${current}${joiner}${word}`;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current.trimEnd());
      current = charWrap ? word.trimStart() : word;
      while (ctx.measureText(current).width > maxWidth && current.length > 1) {
        const chars = Array.from(current);
        let left = "";
        while (chars.length && ctx.measureText(left + chars[0]).width <= maxWidth) {
          left += chars.shift();
        }
        if (left) lines.push(left);
        current = chars.join("");
      }
    } else {
      current = next;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

function drawClosedPath(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** 评级色带唯一映射：A/B 同为 ok 绿族（B 不再用 accent 橙），C=warn，D=danger。 */
function ratingColor(rating: Rating | null): string {
  const color = tokens.light;
  if (rating === "A" || rating === "B") return color.success;
  if (rating === "C") return color.warn;
  if (rating === "D") return color.danger;
  return color.inkSubtle;
}

function toneColor(tone: ReviewDimension["tone"]): string {
  const color = tokens.light;
  if (tone === "ok" || tone === "ok-soft") return color.success;
  if (tone === "warn") return color.warn;
  if (tone === "danger") return color.danger;
  return color.inkSubtle;
}

function canvasTextAlign(anchor: "start" | "middle" | "end"): CanvasTextAlign {
  if (anchor === "start") return "left";
  if (anchor === "end") return "right";
  return "center";
}

function formatReviewDate(value: string): string {
  return formatLocalDateValue(value, value);
}

function formatLanguage(language: Language): string {
  if (language === "python") return "Python";
  return language;
}

async function waitForFonts(): Promise<void> {
  if ("fonts" in document) {
    await document.fonts.ready.catch(() => undefined);
  }
}
