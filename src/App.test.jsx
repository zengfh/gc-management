import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App.jsx';

describe('App', () => {
  it('renders the implementation baseline screen', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /secure gift card manager/i }),
    ).toBeInTheDocument();
  });
});
