import '../styles/globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AppAuthProvider } from '@/lib/auth/provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TravelBuddy',
  description: 'Safe journeys. Trusted companions.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppAuthProvider>{children}</AppAuthProvider>
      </body>
    </html>
  );
}
