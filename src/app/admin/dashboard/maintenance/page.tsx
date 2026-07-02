"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function MaintenanceHubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    setLoading(false);
  }, []);

  const handleExport = () => {
    window.open('/api/admin/maintenance/export', '_blank');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a file to import.");
      return;
    }
    if (!confirm("WARNING: Importing data will completely overwrite the existing database state. Are you sure you want to proceed?")) {
      return;
    }

    setImporting(true);
    setMessage("");
    setError("");

    try {
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        throw new Error("File is not valid JSON.");
      }

      const res = await fetch('/api/admin/maintenance/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to import data.");
      }

      setMessage("Data imported successfully! The database state has been overwritten.");
      setFile(null);
    } catch (err: any) {
      setError(err.message || "An error occurred during import.");
    } finally {
      setImporting(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] py-10 px-2 sm:px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold text-primary tracking-tight drop-shadow-lg">Maintenance Hub</h1>
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Dashboard</Button>
        </div>

        {message && (
          <div className="mb-6 p-4 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">
            {error}
          </div>
        )}

        <div className="space-y-8">
          <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg border border-primary dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4 text-primary">Export Data</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Download a complete JSON backup of your wedding database, including registry items, settings, unified contributors, and snapshot history. Keep this file in a safe place, as it may contain PII (Personally Identifiable Information).
            </p>
            <Button
              onClick={handleExport}
              size="lg"
            >
              Export All Data
            </Button>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg border border-primary dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4 text-primary">Import Data</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Restore your database from a previously exported JSON backup. <strong>Warning:</strong> This will overwrite all current data. Proceed with caution.
            </p>
            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500 dark:text-gray-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-secondary file:text-white
                    hover:file:brightness-90"
                />
              </div>
              <Button
                type="submit"
                variant="danger"
                size="lg"
                disabled={!file || importing}
              >
                {importing ? "Importing..." : "Import Data"}
              </Button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
