// theme.js - apply the chosen theme (system | light | dark) and keep <meta name="theme-color"> in step.

const COLORS = { light: '#F7F6F2', dark: '#121416' };

/**
 * @param {'system'|'light'|'dark'} theme
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  try { localStorage.setItem('intake.theme', theme); } catch { /* storage blocked: the theme still applies this session */ }
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m) => {
    const media = m.getAttribute('data-media') || m.getAttribute('media') || '';
    if (!m.hasAttribute('data-media')) m.setAttribute('data-media', media);
    if (theme === 'light' || theme === 'dark') {
      m.removeAttribute('media');
      m.setAttribute('content', COLORS[theme]);
    } else {
      if (media) m.setAttribute('media', media);
      m.setAttribute('content', media.includes('dark') ? COLORS.dark : COLORS.light);
    }
  });
}
