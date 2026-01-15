import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold mb-4">Cited Investor Q&A</h1>
        <p className="text-lg text-gray-600 mb-8">
          RAG-powered question answering with citations for investor disclosures.
          Each tenant gets their own dedicated database with encrypted credentials.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/demo/example-co"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Try Demo
          </Link>
          <Link
            href="/admin/review"
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            Admin Panel
          </Link>
        </div>
      </div>
    </main>
  );
}
