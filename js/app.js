import { createAppState } from './state.js';
import { initializeUI } from './ui.js';

const appState = createAppState();
initializeUI(appState);
