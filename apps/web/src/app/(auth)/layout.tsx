/**
 * Chrome-free shell for sign-in.
 *
 * Its own route group so the login page renders without the sidebar and top bar, the same way
 * the marketing page at `/` does — showing a signed-out visitor a navigation rail into pages
 * they cannot open would be an odd first impression of a security product.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-canvas">{children}</div>;
}
