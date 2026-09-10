import { App } from './ui/app.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app が見つかりません');
new App(root);
