import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cited Investor Q&A',
  description: 'RAG-powered Q&A with citations for investor disclosures',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
