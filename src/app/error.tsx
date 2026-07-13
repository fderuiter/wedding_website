"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Root boundary caught an error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-16">
      <div className="bg-background p-8 rounded-xl shadow-lg border border-border max-w-md w-full text-center">
        <h2 className="text-2xl font-semibold mb-4 text-foreground">Something went wrong!</h2>
        <p className="text-foreground opacity-80 mb-6">
          An unexpected error occurred in this section of the dashboard. Don't worry, you can try reloading this segment.
        </p>
        <Button onClick={() => reset()} variant="primary" size="lg" className="w-full">
          Try Again
        </Button>
      </div>
    </div>
  );
}
