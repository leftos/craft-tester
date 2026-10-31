import './styles.css';
import { startApp } from '@/ui/app.ts';

const root = document.querySelector('#app');
if (root === null) {
  throw new Error('index.html is missing the #app mount point');
}

startApp(root).catch((error: unknown) => {
  console.error('The trainer could not start.', error);
  root.textContent =
    "The trainer couldn't load. Reload the page; if it keeps happening, please report it.";
});
