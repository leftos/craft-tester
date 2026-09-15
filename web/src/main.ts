import './styles.css';

const root = document.querySelector('#app');
if (root === null) {
  throw new Error('index.html is missing the #app mount point');
}

const heading = document.createElement('h1');
heading.textContent = 'CRAFT Clearance Trainer';
root.append(heading);
