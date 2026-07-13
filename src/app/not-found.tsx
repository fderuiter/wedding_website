import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-16">
      <div className="bg-background p-8 rounded-xl shadow-lg border border-border max-w-md w-full text-center">
        <h2 className="text-3xl font-bold mb-4 text-foreground">404</h2>
        <h3 className="text-xl font-semibold mb-2 text-foreground">Page Not Found</h3>
        <p className="text-foreground opacity-80 mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/" className="btn-primary w-full h-12 text-lg">
          Return Home
        </Link>
      </div>
    </div>
  );
}
