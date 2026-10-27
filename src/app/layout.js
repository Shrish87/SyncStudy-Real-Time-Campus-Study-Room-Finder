import './globals.css';

export const metadata = {
  title: 'SyncStudy',
  description: 'Campus study room finder',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body
        className="min-h-full flex flex-col"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}