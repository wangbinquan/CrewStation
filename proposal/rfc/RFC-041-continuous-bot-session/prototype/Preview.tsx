import { Badge } from '../../../../apps/console/src/shared/ui/Badge';

export function Preview() {
  return <section className="applicationPreview" aria-label="应用预览示意">
    <header><strong>应用预览</strong><Badge tone="neutral">静态示意</Badge></header>
    <div className="gamePreview"><div className="gameIntro"><span>S N A K E</span><h2>贪吃蛇</h2><p>轻点开始，让灵感动起来</p></div>
      <div className="scores"><div><small>本局得分</small><strong>40</strong></div><div><small>最高分</small><strong>120</strong></div></div>
      <svg className="gameBoard" viewBox="0 0 400 360" role="img" aria-label="贪吃蛇游戏静态棋盘"><defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="currentColor" strokeWidth="0.4" /></pattern></defs><rect width="400" height="360" fill="url(#grid)" />
        {[0,1,2,3,4,5].map(i => <rect key={i} x={100+i*20} y="160" width="18" height="18" rx="5" className="snakeCell" opacity={0.45+i*0.1} />)}<rect x="200" y="140" width="18" height="18" rx="5" className="snakeCell" /><circle cx="288" cy="148" r="7" className="foodCell" /></svg>
      <p className="previewHint">此处为布局示意，正式页面继续显示真实应用预览。</p>
    </div>
  </section>;
}
