import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'

export type Expression = 'neutral' | 'happy' | 'sad' | 'thinking' | 'surprised'

interface DigitalHumanProps {
  /** 表情：根据对话内容切换 */
  expression?: Expression
  /** 是否正在说话（用于口型同步） */
  isSpeaking?: boolean
  /** 语音音量 0-1，用于口型开合幅度 */
  speechLevel?: number
  /** 是否启用呼吸与眨眼动画 */
  animate?: boolean
  /** 是否启用肢体动作 */
  bodyMotion?: boolean
  /** 点击数字人触发，例如开启实时对话 */
  onClick?: () => void
  /** 是否处于实时对话模式，用于展示提示文案 */
  realtimeMode?: boolean
  /** 纯净模式：仅渲染数字人，不显示底部文案 */
  minimal?: boolean
  className?: string
}

const VIEW_WIDTH = 200
const VIEW_HEIGHT = 240

/** 根据表情返回嘴巴路径/参数 */
function getMouthShape(
  expression: Expression,
  isSpeaking: boolean,
  speechLevel: number
): { type: 'line' | 'arc' | 'open'; open?: number } {
  if (isSpeaking && speechLevel > 0.05) {
    return { type: 'open', open: Math.min(1, speechLevel * 1.5) }
  }
  switch (expression) {
    case 'happy':
      return { type: 'arc' } // 微笑弧线
    case 'sad':
      return { type: 'arc' } // 可配合倒弧
    case 'surprised':
      return { type: 'open', open: 0.6 }
    case 'thinking':
      return { type: 'line' }
    default:
      return { type: 'line' }
  }
}

/** 根据表情返回眉毛/眼睛的 y 偏移等 */
function getExpressionStyle(expression: Expression) {
  switch (expression) {
    case 'happy':
      return { browY: -2, eyeScaleY: 0.85, arcInvert: false }
    case 'sad':
      return { browY: 4, eyeScaleY: 0.9, arcInvert: true }
    case 'surprised':
      return { browY: -6, eyeScaleY: 1.2, arcInvert: false }
    case 'thinking':
      return { browY: -4, eyeScaleY: 0.9, arcInvert: false }
    default:
      return { browY: 0, eyeScaleY: 1, arcInvert: false }
  }
}

export default function DigitalHuman({
  expression = 'neutral',
  isSpeaking = false,
  speechLevel = 0,
  animate = true,
  bodyMotion = true,
  onClick,
  realtimeMode = false,
  minimal = false,
  className,
}: DigitalHumanProps) {
  const [blink, setBlink] = useState(false)
  const [breath, setBreath] = useState(0)
  const [sway, setSway] = useState(0)
  const [bob, setBob] = useState(0)
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout>>(0)
  const frameRef = useRef(0)

  // 眨眼：随机间隔触发
  useEffect(() => {
    if (!animate) return
    const scheduleNext = () => {
      const delay = 2000 + Math.random() * 3000
      blinkTimeoutRef.current = setTimeout(() => {
        setBlink(true)
        setTimeout(() => setBlink(false), 150)
        scheduleNext()
      }, delay)
    }
    scheduleNext()
    return () => clearTimeout(blinkTimeoutRef.current)
  }, [animate])

  // 呼吸 + 轻微摇摆
  useEffect(() => {
    if (!animate && !bodyMotion) return
    const tick = (t: number) => {
      const tSec = t / 1000
      if (animate) {
        setBreath(Math.sin(tSec * 1.2) * 0.5 + 0.5) // 0~1 呼吸周期
      }
      if (bodyMotion) {
        setSway(Math.sin(tSec * 0.5) * 3) // 轻微左右摇摆
        setBob(Math.sin(tSec * 0.8) * 2) // 轻微上下浮动
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [animate, bodyMotion])

  const mouth = getMouthShape(expression, isSpeaking, speechLevel)
  const style = getExpressionStyle(expression)
  const breathScale = 1 + (animate ? (breath * 0.04 - 0.02) : 0) // 约 0.98~1.02
  const eyeClose = blink ? 0.15 : 1

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center w-full',
        onClick &&
          'cursor-pointer select-none hover:opacity-90 active:scale-[0.98] transition-transform',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? (realtimeMode ? '点击关闭实时对话' : '点击开启实时对话') : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="w-full h-auto max-w-[140px] max-h-[168px] sm:max-w-[160px] sm:max-h-[192px] md:max-w-[180px] md:max-h-[216px] lg:max-w-[200px] lg:max-h-[240px] portrait:max-h-[200px] landscape:max-md:max-h-[140px]"
        style={{ overflow: 'visible' }}
      >
        <g transform={`translate(${VIEW_WIDTH / 2}, ${VIEW_HEIGHT / 2})`}>
          {/* 身体（呼吸缩放 + 轻微摇摆 + 上下浮动） */}
          <g
            transform={`scale(${breathScale}) rotate(${sway}) translate(0, ${28 + bob})`}
            style={{ transformOrigin: 'center 0' }}
          >
            <ellipse
              cx={0}
              cy={20}
              rx={32}
              ry={38}
              fill="rgb(59, 130, 246)"
              className="transition-colors duration-300"
            />
            <ellipse
              cx={0}
              cy={20}
              rx={28}
              ry={34}
              fill="rgb(96, 165, 250)"
              opacity={0.6}
            />
          </g>

          {/* 头部 */}
          <g transform="translate(0, -45)">
            <circle
              r={42}
              fill="rgb(255, 228, 214)"
              className="transition-colors duration-300"
            />
            <circle
              r={38}
              fill="rgb(255, 236, 230)"
              opacity={0.8}
            />

            {/* 左眼 */}
            <g transform="translate(-14, -8)">
              <ellipse
                cx={0}
                cy={0}
                rx={6}
                ry={6 * eyeClose}
                fill="#333"
                style={{
                  transformOrigin: 'center center',
                  transition: blink ? 'none' : 'ry 0.1s ease-out',
                }}
              />
              {expression === 'surprised' && (
                <circle r={2} fill="#333" cy={-2} />
              )}
            </g>
            {/* 右眼 */}
            <g transform="translate(14, -8)">
              <ellipse
                cx={0}
                cy={0}
                rx={6}
                ry={6 * eyeClose}
                fill="#333"
              />
              {expression === 'surprised' && (
                <circle r={2} fill="#333" cy={-2} />
              )}
            </g>

            {/* 眉毛（随表情） */}
            <line
              x1={-22}
              y1={-18 + style.browY}
              x2={-6}
              y2={-20 + style.browY}
              stroke="#555"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <line
              x1={6}
              y1={-20 + style.browY}
              x2={22}
              y2={-18 + style.browY}
              stroke="#555"
              strokeWidth={2.5}
              strokeLinecap="round"
            />

            {/* 嘴巴：线 / 弧 / 张合 */}
            <g transform="translate(0, 12)">
              {mouth.type === 'line' && (
                <line
                  x1={-10}
                  y1={0}
                  x2={10}
                  y2={0}
                  stroke="#444"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )}
              {mouth.type === 'arc' && (
                <path
                  d={
                    style.arcInvert
                      ? `M -10 4 Q 0 -4 10 4`
                      : `M -10 -2 Q 0 6 10 -2`
                  }
                  fill="none"
                  stroke="#444"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )}
              {mouth.type === 'open' && (
                <ellipse
                  cx={0}
                  cy={2}
                  rx={8}
                  ry={4 + (mouth.open ?? 0) * 6}
                  fill="#333"
                  style={{
                    transition: 'ry 0.08s ease-out',
                  }}
                />
              )}
            </g>
          </g>
        </g>
      </svg>
      {!minimal && (
        <>
          <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            {realtimeMode ? '实时对话已开启 · 回复将语音播报' : '数字人助手'}
          </p>
          {onClick && !realtimeMode && (
            <p className="mt-0.5 text-[11px] sm:text-xs text-primary-500 dark:text-primary-400">
              点击开启实时对话
            </p>
          )}
        </>
      )}
    </div>
  )
}
