export const metadata = { title: 'Boardplot server rendering example' };

export default function RootLayout({ children }) {
  return <html lang="en"><body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body></html>;
}
