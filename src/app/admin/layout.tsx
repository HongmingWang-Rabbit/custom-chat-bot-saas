import Link from 'next/link';

/**
 * Admin layout with modern navigation.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="text-xl font-semibold tracking-tight text-gray-900">
              cited<span className="text-blue-500">Q&A</span>
            </Link>

            {/* Navigation Links */}
            <div className="flex items-center gap-1">
              <NavLink href="/admin">Dashboard</NavLink>
              <NavLink href="/admin/tenants">Organizations</NavLink>
              <NavLink href="/admin/documents">Documents</NavLink>
              <NavLink href="/admin/review">Q&A Logs</NavLink>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-4">
              <Link
                href="/demo/demo-company"
                className="text-sm text-gray-600 hover:text-gray-900 transition"
              >
                View Demo
              </Link>
              <Link
                href="/admin/tenants/new"
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 transition"
              >
                + New Organization
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
    >
      {children}
    </Link>
  );
}
