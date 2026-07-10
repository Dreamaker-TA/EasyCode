/**
 * EasyCode · Design Tokens（方向 B · iA Writer 阅读派）
 *
 * 这是全前端 UI 的**规范源**。任何颜色 / 字号 / 间距凡是用到的，必须在此声明，
 * 然后通过 CSS 变量（globals.css 注入）或 import 此对象引用。
 * 不允许在组件里临场写新 hex。
 *
 * 设计哲学：iA Writer + Bear Notes 的纸感阅读体验。
 * - 题面用衬线（"读"的语言）
 * - 代码用等宽（"写"的语言）
 * - UI 用系统字体（"操作"的语言）
 * - 单一赤土橙 accent 贯穿全场，不引入第二种强色
 */

export const tokens = {
  light: {
    bg: "#faf9f7",
    bgElevated: "#ffffff",
    bgSoft: "#f3f1ec",
    ink: "#1a1a1c",
    inkMuted: "#5e5c58",
    inkSubtle: "#6f6a62",
    line: "#e8e5df",
    lineStrong: "#d6d2ca",
    accent: "#c04a1a", // 赤土橙
    accentStrong: "#a93f17",
    accentMuted: "#e9c8b6",
    inkOnAccent: "#ffffff",
    success: "#246b31",
    warn: "#8a5f00",
    danger: "#a3361a",
  },
  dark: {
    bg: "#1a1916",
    bgElevated: "#23211d",
    bgSoft: "#2a2823",
    ink: "#ede9e0",
    inkMuted: "#a8a39a",
    inkSubtle: "#9a948a",
    line: "#33302a",
    lineStrong: "#45413a",
    accent: "#d96b3a", // 夜间稍亮一档
    accentStrong: "#bf5528",
    accentMuted: "#5a3a2a",
    inkOnAccent: "#1a1916",
    success: "#82bf83",
    warn: "#d2a13a",
    danger: "#d57a5a",
  },
  font: {
    serif:
      '"Iowan Old Style", "Source Serif Pro", "Source Serif", Georgia, "Songti SC", serif',
    sans:
      '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", Roboto, sans-serif',
    mono:
      '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
  },
  size: {
    // 节奏：8px 网格 + 衬线题面用更宽的呼吸
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    "2xl": 32,
    "3xl": 48,
  },
  text: {
    "2xs": 10, // 密度带下沿：微标签 / 徽标计数（原 9.5–10.5 裸值归此）
    xs: 11,
    "2sm": 12, // 数据面主力小字（原 12/12.5 裸值，出现最多，独立成档避免整体位移）
    sm: 13,
    base: 14,
    md: 15,
    lg: 17,
    xl: 20,
    "2xl": 24,
    display: 30, // 大号展示数字 / 页面标题（原 28/30 裸值归此）
    "3xl": 32,
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    pill: 999,
  },
  motion: {
    fast: "120ms",
    medium: "180ms",
    slow: "240ms",
    reveal: "1200ms", // 一次性揭示基准时长（五维雷达绘入专用）
    easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
    easeEnter: "cubic-bezier(0, 0, 0.2, 1)",
    easeExit: "cubic-bezier(0.4, 0, 1, 1)",
    easeSpring: "cubic-bezier(0.34, 1.56, 0.64, 1)", // 回弹（雷达圆点 / 签名回弹）
  },
  /**
   * Monaco 编辑器主题数值源。两套主题与应用壳同气质：
   *   easycode-paper（暖纸浅色）—— chrome 对齐 --bg-elevated / --bg，不再刺眼纯白冷白
   *   easycode-ink  （暖墨深色）—— 取代 vs-dark 的冷蓝黑，落回暖墨底
   * 语法色是一组克制的暖调（keyword 赤陶、string 苔绿、comment 弱化暖灰、
   * number/常量 琥珀、function 靛蓝偏暖、type 陶棕），浅深两套都与底色保持
   * 清晰可读对比，禁高饱和荧光。这里是编辑器主题的唯一 hex 源，
   * monaco-setup.ts 只 import 不散落。
   */
  monaco: {
    paper: {
      // chrome：编辑器底 = 应用 --bg-elevated（写题主面），周边件对齐暖纸
      base: "vs" as const,
      bg: "#ffffff",
      fg: "#1a1a1c",
      lineHighlight: "#f3f1ec", // 当前行 = --bg-soft 暖纸
      selection: "#e9c8b6", // 选区 = accent-muted 暖染
      selectionHighlight: "#f0dcce", // 同词高亮更浅一档
      cursor: "#c04a1a", // 光标 = accent 赤陶
      gutterFg: "#a49e94", // 行号弱化暖灰
      gutterActiveFg: "#5e5c58", // 当前行号 = ink-muted
      indentGuide: "#eceae4",
      indentGuideActive: "#d6d2ca",
      whitespace: "#dcd8d0",
      scrollbarSlider: "#dbd6cd",
      // 语法（克制暖调）
      keyword: "#b0431a", // 关键字：赤陶（比 accent 深一档，正文里不与 CTA 撞）
      string: "#4d6b3a", // 字符串：苔绿
      comment: "#9a938a", // 注释：弱化暖灰、偏斜体
      number: "#9a6410", // 数字 / 常量：琥珀
      func: "#3f5c8a", // 函数名：靛蓝偏暖
      type: "#8a5230", // 类型 / 类名：陶棕
      operator: "#6f6a62", // 运算符：中性暖灰
      variable: "#1a1a1c", // 变量：正文墨
      punctuation: "#6f6a62",
    },
    ink: {
      base: "vs-dark" as const,
      bg: "#1a1916", // = 应用 --bg 暖墨
      fg: "#ede9e0",
      lineHighlight: "#23211d", // 当前行 = --bg-elevated
      selection: "#5a3a2a", // 选区 = accent-muted（夜）
      selectionHighlight: "#4a3324",
      cursor: "#d96b3a", // 光标 = accent（夜）
      gutterFg: "#6d675e",
      gutterActiveFg: "#a8a39a",
      indentGuide: "#2c2a24",
      indentGuideActive: "#45413a",
      whitespace: "#3a372f",
      scrollbarSlider: "#3f3b34",
      // 语法（夜间提亮一档，仍暖仍克制）
      keyword: "#e08a5a", // 关键字：亮赤陶
      string: "#a7c489", // 字符串：亮苔绿
      comment: "#8a8378", // 注释：暖灰
      number: "#d2a13a", // 数字 / 常量：琥珀（= warn 夜）
      func: "#8fa9d6", // 函数名：柔靛蓝
      type: "#d29b72", // 类型 / 类名：陶棕
      operator: "#a8a39a", // 运算符：ink-muted
      variable: "#ede9e0",
      punctuation: "#a8a39a",
    },
  },
} as const;

export type Theme = "light" | "dark";
