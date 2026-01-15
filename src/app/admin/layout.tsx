import Link from 'next/link';

/**
 * Admin layout with navigation sidebar.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex-shrink-0">
        <div className="p-4 border-b border-gray-800">
          <Link href="/admin" className="text-xl font-bold">
            Admin Panel
          </Link>
        </div>
        <nav className="p-4">
          <ul className="space-y-2">
            <li>
              <Link
                href="/admin/review"
                className="block px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Q&A Review
              </Link>
            </li>
            <li>
              <Link
                href="/admin/documents"
                className="block px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Documents
              </Link>
            </li>
            <li>
              <Link
                href="/admin/tenants"
                className="block px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Tenants
              </Link>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-gray-50 dark:bg-gray-900">
        {children}
      </main>
    </div>
  );
}
