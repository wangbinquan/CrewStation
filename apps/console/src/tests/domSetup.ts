import { GlobalRegistrator } from '@happy-dom/global-registrator';

/**
 * 渲染测试用的 DOM。必须在任何 react-dom 之前求值，所以单独成一个模块，
 * 测试文件把它写成第一条 import——ESM 按 import 顺序求值依赖。
 */
if (!('document' in globalThis)) GlobalRegistrator.register();

// React 的 act() 只在这个开关打开时才刷新更新队列，否则每次调用都警告且什么也不等。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
