import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dispensador IoT',
  description: 'Panel de control del dispensador inteligente de alimento',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
