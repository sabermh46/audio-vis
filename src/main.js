import { App } from './App.js';

const app = new App();
app.init(document.getElementById('app'));

// Exposed for console debugging during development.
window.__app = app;
