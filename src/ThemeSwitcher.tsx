import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from './useTheme';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switcher">
      <button
        type="button"
        className={theme === 'light' ? 'active' : ''}
        onClick={() => setTheme('light')}
        title="Light Mode"
        aria-label="Light Mode"
      >
        <Sun size={16} />
      </button>
      <button
        type="button"
        className={theme === 'auto' ? 'active' : ''}
        onClick={() => setTheme('auto')}
        title="Auto (System Time)"
        aria-label="Auto (System Time)"
      >
        <Monitor size={16} />
      </button>
      <button
        type="button"
        className={theme === 'dark' ? 'active' : ''}
        onClick={() => setTheme('dark')}
        title="Dark Mode"
        aria-label="Dark Mode"
      >
        <Moon size={16} />
      </button>
    </div>
  );
}
