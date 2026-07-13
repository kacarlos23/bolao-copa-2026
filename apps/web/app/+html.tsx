import type { ReactNode } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" translate="no" className="notranslate">
      <head>
        <meta name="google" content="notranslate" />
        <ScrollViewStyleReset />
      </head>
      <body translate="no" className="notranslate">
        {children}
      </body>
    </html>
  );
}
