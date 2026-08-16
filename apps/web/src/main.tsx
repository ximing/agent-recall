import { register, resolve, RSRoot } from '@rabjs/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { AuthService } from '@/services/auth.service';
import { ThemeService } from '@/services/theme.service';
import '@/styles.css';

register(AuthService);
register(ThemeService);
void resolve(AuthService).bootstrap();
resolve(ThemeService).init();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <RSRoot>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RSRoot>
    </StrictMode>,
  );
}
