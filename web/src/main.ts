import './styles.css';
import { startApp } from '@/ui/app.ts';

const root = document.querySelector('#app');
if (root === null) {
  throw new Error('index.html is missing the #app mount point');
}

startApp(root).catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  root.textContent = `The trainer could not start: ${reason}`;
});
