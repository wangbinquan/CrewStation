// 设计附件的类型垫片：生产 console 靠 vite/client 声明 CSS module，这里独立声明一份。
declare module '*.module.css' { const classes: Readonly<Record<string, string>>; export = classes; }
declare module '*.css';
