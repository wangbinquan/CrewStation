# RFC-003｜CrewStation 品牌标识

> Draft · 2026-09-13。作者要求系统图标直观、有辨识度、容易记住。本稿交付可直接用于后续实现的矢量原稿，生产图标尚未替换。

## 协作舱

![CrewStation 协作舱](./crewstation-mark.svg)

C 形工作站对应 CrewStation，容纳三个独立并行轨道；右侧终端箭头表示执行和共同交付。三条轨道是协作意象，不规定 Agent 数量。图形保留单一轮廓，避免把终端、机器人、齿轮等符号堆在一起。

主标使用深蓝绿底、浅白 C 形和薄荷绿轨道；双色标的固定品牌色不参与运行状态编码，产品按钮和状态继续沿主题 tokens。单色版本继承 currentColor，适合文档、紧凑导航和深浅主题。

| 资产 | 用途 |
|---|---|
| [crewstation-mark.svg](./crewstation-mark.svg) | 应用图标、登录页、产品顶栏；64×64 viewBox，透明圆角外部 |
| [crewstation-mark-mono.svg](./crewstation-mark-mono.svg) | 单色字标组合、印刷与主题背景 |

顶栏使用 28px 图标配 CrewStation 字标。可点击标识查看 16／24／32／64／128px 和单色预览；交互附件未修改浏览器真实 favicon。后续把品牌资产放入 console 的 public 品牌目录，favicon／登录页／顶栏使用同一原稿，避免重新描摹出多个近似图标。图标与名称相邻时视为装饰，独立图标有 CrewStation 可访问名称。

验收关注小尺寸轮廓、单色识别、深浅背景和顶栏密度；不以视觉稿冒充已完成生产品牌替换。
