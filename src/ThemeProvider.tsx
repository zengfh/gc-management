import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'auto' | 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  activeTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTimeTheme(): 'light' | 'dark' {
  const hour = new Date().getHours();
  // Dark mode for evening/night (18:00 to 05:59), light mode for morning/afternoon
  if (hour >= 18 || hour < 6) {
    return 'dark';
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('app-theme') as Theme) || 'auto';
  });

  const [activeTheme, setActiveTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    function applyTheme() {
      const resolved = theme === 'auto' ? getSystemTimeTheme() : theme;
      setActiveTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    }

    applyTheme();

    // If auto, we should probably check periodically in case time crosses 18:00 or 06:00
    let interval: number;
    if (theme === 'auto') {
      interval = window.setInterval(applyTheme, 60000); // Check every minute
    }

    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem('app-theme', newTheme);
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, activeTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
