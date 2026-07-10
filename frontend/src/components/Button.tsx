import type { ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";

import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface StyleProps {
  /** primary = accent 实心；secondary = 1px 边框；ghost = 无边框；danger = danger 色系。 */
  variant?: ButtonVariant;
  /** sm 28px / md 36px / lg 44px，全站只有这三档高度。 */
  size?: ButtonSize;
  /** 占满容器宽度（footer 主动作、移动端堆叠等布局场景）。 */
  block?: boolean;
  /** QA 结构锚点等 data-* 属性直通。 */
  [dataAttr: `data-${string}`]: string | boolean | undefined;
}

type NativeButtonProps = StyleProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { as?: "button" };

/** "链接长得像按钮"场景：渲染 react-router Link，同一套视觉。 */
type LinkButtonProps = StyleProps & LinkProps & { as: "link" };

export type ButtonProps = NativeButtonProps | LinkButtonProps;

function composeClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  block: boolean,
  className: string | undefined,
): string {
  return [styles.btn, styles[variant], styles[size], block ? styles.block : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * 全站唯一按钮实现。
 * - hover / active = color-mix 加深；无位移、无缩放、无阴影。
 * - disabled 统一 opacity 0.5；focus-visible = 2px accent 环 + 2px offset。
 * - 载入中态 = 调用方替换文字（如「提交中…」）并置 disabled，不加 spinner 图标。
 */
export function Button(props: ButtonProps) {
  if (props.as === "link") {
    const { as: _as, variant = "secondary", size = "md", block = false, className, ...rest } = props;
    return <Link {...rest} className={composeClassName(variant, size, block, className)} />;
  }
  const {
    as: _as,
    variant = "secondary",
    size = "md",
    block = false,
    className,
    type,
    ...rest
  } = props;
  return (
    <button
      {...rest}
      type={type ?? "button"}
      className={composeClassName(variant, size, block, className)}
    />
  );
}
