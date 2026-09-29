import { ComponentProps } from 'react';
import { ExtraProps } from 'react-markdown';
import { Link } from '@/components/ui/dads/Link';

export const isSameOriginUrl = (src: unknown): src is string => {
  if (typeof src !== 'string' || src === '') return false;
  try {
    return new URL(src, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

export const MarkdownImage = ({ src, alt, title }: ComponentProps<'img'> & ExtraProps) => {
  if (isSameOriginUrl(src)) {
    return <img src={src} alt={alt ?? ''} title={title} />;
  }
  if (typeof src !== 'string' || src === '') {
    return <>{alt}</>;
  }
  return (
    <Link href={src} target='_blank' rel='noopener noreferrer'>
      {alt || src}
    </Link>
  );
};
