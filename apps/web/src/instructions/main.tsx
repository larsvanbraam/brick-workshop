import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../workspace.css';
import '../part-browser.css';
import './instructions.css';
import { InstructionsApp } from './InstructionsApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InstructionsApp />
  </StrictMode>,
);
